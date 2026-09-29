/**
 * SessionManager — orchestrates the full ACP lifecycle for an agent scan.
 *
 * FSM: spawning → initializing → creating_session → prompting → streaming → done | error | cancelled.
 *
 * Responsibilities:
 * 1. Spawn agent binary via {@link spawnLoginShell}
 * 2. Race process exit against connect (emit error on non-zero early exit)
 * 3. Create connection via {@link ConnectionManager}
 * 4. Initialize ACP session (with auth-retry on -32000)
 * 5. Send prompt
 * 6. Stream session updates as {@link ProviderEvent}s via async generator
 * 7. Handle cancellation via AbortSignal
 * 8. Prevent process leaks via always-on finally block
 *
 * @module session-manager
 */
import { spawnLoginShell } from './spawn-shell'
import { ConnectionManager } from './connection-manager'
import { RequestError } from '@agentclientprotocol/sdk'
import { logTraffic } from './traffic-logger'
import * as PendingTurnQueue from './pending-turn-queue'
import type { AgentDef } from '@/lib/providers/cli/agents'
import type { ScanOpts, ProviderEvent } from '@/lib/providers/index'
import type { SpawnResult } from './spawn-shell'
import type { AcpClientEvent } from './acp-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tagged error thrown when the agent process exits before a session could
 * be created. Carries the exit code so the catch block can format the
 * error message appropriately.
 */
class EarlyExitError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message)
    this.name = 'EarlyExitError'
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full ACP agent session lifecycle.
 *
 * Uses an async generator to yield {@link ProviderEvent}s in real-time
 * as they arrive from the agent. The generator terminates after emitting
 * a {@link DoneEvent} (success) or an {@link ErrorEvent} (failure).
 *
 * The spawned process is always killed in the `finally` block to prevent
 * zombie processes, regardless of how the scan terminates.
 *
 * @example
 * ```ts
 * const mgr = new SessionManager()
 * for await (const event of mgr.run(agentDef, 'Find security bugs', opts, signal)) {
 *   handleProviderEvent(event)
 * }
 * ```
 */
export class SessionManager {
  /** Map of sessionId → connection for setMode/setModel delegation. */
  private sessions = new Map<string, {
    connection: {
      setSessionMode(params: { sessionId: string; modeId: string }): Promise<unknown>
      unstable_setSessionModel(params: { sessionId: string; modelId: string }): Promise<unknown>
    }
  }>()

  /**
   * Execute a scan via the ACP transport.
   *
   * @param def - Agent definition (bin, acpArgs, env, etc.)
   * @param prompt - The security scanning prompt to send
   * @param opts - Scan options including targetPath
   * @param signal - Optional AbortSignal for cancellation
   * @yields ProviderEvents as they arrive from the agent
   */
  async *run(
    def: AgentDef,
    prompt: string,
    opts: ScanOpts,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const connectionManager = new ConnectionManager()
    let spawned: SpawnResult | null = null
    let aborted = false

    // Stable queue key for this run — used throughout the lifecycle including finally.
    // Generated at entry so closeScan is always called with the same key.
    const queueId = crypto.randomUUID()
    // Acquire the queue instance eagerly so forScan() is always called.
    PendingTurnQueue.forScan(queueId)

    try {
      // ---- Phase 1: Spawn ----
      spawned = spawnLoginShell(def.bin, def.acpArgs ?? [], {
        cwd: opts.targetPath,
        env: def.env,
        onStderrLine: (line) => {
          logTraffic('recv', { stream: 'stderr', line })
        },
      })

      // ---- Phase 2: Connect (raced against early process exit) ----
      // If the agent exits non-zero before we connect, we emit an error.
      // We race connect against a promise that watches the process exit.
      const connectPromise = connectionManager.connect(def.id, {
        stdout: spawned.process.stdout!,
        stdin: spawned.process.stdin!,
      })

      // Watch for early exit: if the process exits non-zero before we connect,
      // reject so the race propagates an EarlyExitError.
      // Typed as Promise<never> so the race result stays ConnectionInfo.
      const spawnedRef = spawned
      const earlyExitPromise = new Promise<never>((_, reject) => {
        void spawnedRef.exited.then(async (exit) => {
          if (exit.code !== null && exit.code !== 0) {
            const chunks: string[] = []
            for await (const chunk of spawnedRef.stderr) {
              chunks.push(chunk)
            }
            const stderr = chunks.join('').trim()
            reject(new EarlyExitError(
              `Agent process exited with code ${exit.code}${stderr ? ': ' + stderr : ''}`,
              exit.code,
              stderr,
            ))
          }
          // Exit code 0: unusual but not fatal — let connectPromise win.
        }).catch(reject)
      })

      const { connection, client, initResponse } = await Promise.race([
        connectPromise,
        earlyExitPromise,
      ])

      // ---- Phase 4: Event bridging state (declared before first use) ----
      // All mutable state for the async generator bridge must be initialised
      // here — before Phase 4 calls pushEvent and before client.onEvent is
      // wired so the callbacks never hit a TDZ.
      const eventBuffer: ProviderEvent[] = []
      let pendingResolver: ((result: IteratorResult<ProviderEvent>) => void) | null = null
      let promptDone = false
      let sessionCompleted = false
      let stopReason: string | undefined

      const pushEvent = (event: ProviderEvent): void => {
        if (pendingResolver) {
          const resolve = pendingResolver
          pendingResolver = null
          resolve({ value: event, done: false })
        } else {
          eventBuffer.push(event)
        }
      }

      // ---- Phase 5: Emit agent identity ----
      // Use initResponse.agentInfo to provide agent name and version
      if (initResponse?.agentInfo) {
        pushEvent({
          type: 'server_info',
          agentId: initResponse.agentInfo.name ?? def.id,
          agentVersion: initResponse.agentInfo.version,
          capabilities: initResponse.agentCapabilities,
        })
      }

      // ---- Phase 6: Wire onEvent callback ----
      // Wire the AcpScanClient's onEvent to push events into our queue.
      // AcpClientEvents include SessionUpdateHandlerEvent and DoneEvent.
      // The `done` event from onEvent signals that the agent sent a completing
      // sessionUpdate (status:"completed") — we track it but don't yield it directly.
      // The final `done` ProviderEvent is yielded after promptPromise resolves.
      client.onEvent = (ev: AcpClientEvent) => {
        if (ev.type === 'done') {
          // Store 'done' as a completion signal — don't push as a ProviderEvent.
          // The generator yields a single done ProviderEvent after promptPromise.
          sessionCompleted = true
        } else {
          pushEvent(ev as unknown as ProviderEvent)
        }
      }

      // ---- Phase 7: Create session (with auth-retry on -32000) ----
      let sessionId: string
      try {
        const nsRes = await connection.newSession({
          cwd: opts.targetPath,
          mcpServers: [],
        })
        sessionId = nsRes.sessionId
        // Store connection for setMode/setModel delegation
        this.sessions.set(sessionId, { connection: connection as unknown as { setSessionMode(params: { sessionId: string; modeId: string }): Promise<unknown>; unstable_setSessionModel(params: { sessionId: string; modelId: string }): Promise<unknown> } })
      } catch (err: unknown) {
        if (
          err instanceof RequestError &&
          err.code === -32000
        ) {
          // Auth required — authenticate and retry once
          await connection.authenticate({} as Parameters<typeof connection.authenticate>[0])
          const nsRes = await connection.newSession({
            cwd: opts.targetPath,
            mcpServers: [],
          })
          sessionId = nsRes.sessionId
          // Store connection for setMode/setModel delegation
          this.sessions.set(sessionId, { connection: connection as unknown as { setSessionMode(params: { sessionId: string; modeId: string }): Promise<unknown>; unstable_setSessionModel(params: { sessionId: string; modelId: string }): Promise<unknown> } })
        } else {
          throw err
        }
      }

      // ---- Phase 8: Abort signal handling ----
      if (signal) {
        if (signal.aborted) {
          aborted = true
          yield { type: 'error', message: 'Scan aborted before prompt' }
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            // Mark prompt as done so the streaming loop terminates
            promptDone = true
            // Best-effort cancel the ACP session
            connection
              .cancel({ sessionId } as Parameters<typeof connection.cancel>[0])
              .catch(() => {})
            // Push an error event to unblock the generator
            pushEvent({ type: 'error', message: 'Scan aborted' })
            // Also resolve the pending promise if the generator is awaiting
            if (pendingResolver) {
              pendingResolver({
                value: { type: 'error', message: 'Scan aborted' },
                done: false,
              })
              pendingResolver = null
            }
          },
          { once: true },
        )
      }

      // ---- Phase 9: Send prompt ----
      const promptPromise = connection
        .prompt({
          sessionId,
          prompt: [{ type: 'text', text: prompt }],
        })
        .then((res) => {
          stopReason = res.stopReason
          promptDone = true
          // If the generator is awaiting, wake it up so it can
          // flush the buffer and emit done.
          if (pendingResolver) {
            const resolve = pendingResolver
            pendingResolver = null
            resolve({ value: undefined as unknown as ProviderEvent, done: true })
          }
        })
        .catch((err: unknown) => {
          promptDone = true
          const message = err instanceof Error ? err.message : String(err)
          pushEvent({ type: 'error', message })
          if (pendingResolver) {
            const resolve = pendingResolver
            pendingResolver = null
            resolve({ value: { type: 'error', message } as ProviderEvent, done: false })
          }
        })

      // ---- Phase 10: Stream events ----
      while (!promptDone || eventBuffer.length > 0) {
        // If events are buffered, yield the next one immediately
        if (eventBuffer.length > 0) {
          yield eventBuffer.shift()!
          continue
        }

        // If prompt is complete and no events remaining, we are done streaming
        if (promptDone) break

        // Otherwise, wait for the next event or prompt completion
        const result = await new Promise<IteratorResult<ProviderEvent>>(
          (resolve) => {
            pendingResolver = resolve
          },
        )

        if (result.done) {
          // Prompt completed while we were waiting
          break
        }
        yield result.value
      }

      // ---- Phase 11: Await prompt resolution ----
      if (!aborted) {
        await promptPromise
      }

      // ---- Phase 12: Yield done ----
      // Emit stop_reason before done so consumers can inspect why the agent stopped.
      if (stopReason) {
        yield { type: 'stop_reason', reason: stopReason }
      }
      yield { type: 'done' }
    } catch (err: unknown) {
      // Handle early process exit specially — emit a clean error event
      if (err instanceof EarlyExitError) {
        yield { type: 'error', message: err.message }
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message }
    } finally {
      // ---- Process leak prevention: always kill ----
      // kill() handles SIGTERM → 5s grace → SIGKILL internally.
      spawned?.kill()
      connectionManager.dispose()
      // Release the per-scan pending turn queue (drain + remove from registry).
      PendingTurnQueue.closeScan(queueId)
    }
  }

  /**
   * Set the session mode (e.g., plan mode, code mode).
   *
   * Delegates to the underlying ACP connection's `setSessionMode` method.
   * No-ops silently if the session ID is unknown.
   *
   * @param sessionId - The session identifier from newSession()
   * @param modeId - The mode identifier to activate
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await session.connection.setSessionMode({ sessionId, modeId })
  }

  /**
   * Set the session model (experimental ACP API).
   *
   * Delegates to the underlying ACP connection's `unstable_setSessionModel` method.
   * No-ops silently if the session ID is unknown.
   *
   * @param sessionId - The session identifier from newSession()
   * @param modelId - The model identifier to activate
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await session.connection.unstable_setSessionModel({ sessionId, modelId })
  }
}
