/**
 * terminal-handler.ts — Manages terminal lifecycle for ACP agent sessions.
 *
 * Implements the Client-side terminal operations defined by the ACP spec:
 *   - createTerminal: spawn a shell command with byte-limited output capture
 *   - terminalOutput: retrieve current output and exit status
 *   - waitForTerminalExit: await process completion
 *   - killTerminal: SIGTERM a running terminal
 *   - releaseTerminal: kill (if running) and clean up
 *   - dispose: kill all managed terminals
 *
 * No VS Code deps — built on node:child_process and node:crypto.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ChildProcess, ChildProcessByStdio } from 'node:child_process'
import type { Writable, Readable } from 'node:stream'
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalExitStatus,
} from '@agentclientprotocol/sdk'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Per-terminal state tracked by TerminalHandler. */
interface ManagedTerminal {
  id: string
  process: ChildProcessByStdio<Writable, Readable, Readable>
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode: number | null
  exitSignal: string | null
  exited: boolean
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>
}

/** Shape of the optional SSE output callback event. */
export interface TerminalOutputEvent {
  terminalId: string
  output: string
  truncated?: boolean
}

export interface TerminalHandlerOptions {
  /**
   * Optional SSE output callback.
   * Called every time the terminal receives stdout or stderr data.
   */
  onOutput?: (event: TerminalOutputEvent) => void
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024 // 1 MiB

// ---------------------------------------------------------------------------
// TerminalHandler
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of terminals spawned for ACP agent sessions.
 *
 * Each terminal runs a shell command via `node:child_process`. Output is
 * accumulated and optionally byte-limited (truncating oldest data first).
 * An optional SSE output callback fires whenever new data arrives.
 *
 * @example
 * ```ts
 * const handler = new TerminalHandler({
 *   onOutput: (event) => emitSse('terminal_output', event),
 * })
 *
 * const { terminalId } = await handler.createTerminal({
 *   command: 'npm', args: ['test'], sessionId: 's1', outputByteLimit: 65536,
 * })
 *
 * const out = await handler.terminalOutput({ terminalId, sessionId: 's1' })
 * console.log(out.output, out.truncated)
 *
 * const exit = await handler.waitForTerminalExit({ terminalId, sessionId: 's1' })
 * console.log(exit.exitCode)
 *
 * await handler.releaseTerminal({ terminalId, sessionId: 's1' })
 * ```
 */
export class TerminalHandler {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private readonly onOutput?: (event: TerminalOutputEvent) => void

  constructor(options?: TerminalHandlerOptions) {
    this.onOutput = options?.onOutput
  }

  // -----------------------------------------------------------------------
  // createTerminal
  // -----------------------------------------------------------------------

  /**
   * Spawn a command in a new terminal.
   *
   * The returned `terminalId` is a unique handle used by all other methods.
   * Output is accumulated in-memory and capped at `outputByteLimit` (default
   * 1 MiB). When the limit is exceeded, the oldest data is dropped.
   */
  async createTerminal(
    params: CreateTerminalRequest,
  ): Promise<CreateTerminalResponse> {
    const terminalId = randomUUID()
    const byteLimit = params.outputByteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT

    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? process.cwd(),
      env: (this.buildEnv(params.env) ?? process.env) as NodeJS.ProcessEnv,
      stdio: 'pipe',
    }) as ChildProcessByStdio<Writable, Readable, Readable>

    // Drain stdin immediately — the command may not read from it
    child.stdin?.end()

    const terminal: ManagedTerminal = {
      id: terminalId,
      process: child,
      output: '',
      truncated: false,
      outputByteLimit: byteLimit,
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise: null!,
    }

    /** Append chunk to output, truncating from the beginning if over limit. */
    const append = (chunk: string): void => {
      terminal.output += chunk
      const byteLen = Buffer.byteLength(terminal.output, 'utf-8')
      if (byteLen > byteLimit) {
        // Truncate from the beginning: keep only the last `byteLimit` bytes.
        const buf = Buffer.from(terminal.output, 'utf-8')
        const excess = byteLen - byteLimit
        terminal.output = buf.subarray(excess).toString('utf-8')
        terminal.truncated = true
      }
    }

    // Capture stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf-8')
      append(str)
      this.onOutput?.({ terminalId, output: str, truncated: terminal.truncated })
    })

    // Capture stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      const str = chunk.toString('utf-8')
      append(str)
      this.onOutput?.({ terminalId, output: str, truncated: terminal.truncated })
    })

    // Create exitPromise that also updates the terminal's exit state
    terminal.exitPromise = new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolve) => {
        child.on('close', (code, signal) => {
          terminal.exitCode = code ?? null
          terminal.exitSignal = signal ?? null
          terminal.exited = true
          resolve({ exitCode: terminal.exitCode, signal: terminal.exitSignal })
        })
      },
    )

    this.terminals.set(terminalId, terminal)
    return { terminalId }
  }

  // -----------------------------------------------------------------------
  // terminalOutput
  // -----------------------------------------------------------------------

  /**
   * Return the current accumulated output and exit status (if any).
   */
  async terminalOutput(
    params: TerminalOutputRequest,
  ): Promise<TerminalOutputResponse> {
    const terminal = this.lookup(params.terminalId)

    const exitStatus: TerminalExitStatus | undefined = terminal.exited
      ? { exitCode: terminal.exitCode, signal: terminal.exitSignal }
      : undefined

    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus: exitStatus ?? null,
    }
  }

  // -----------------------------------------------------------------------
  // waitForTerminalExit
  // -----------------------------------------------------------------------

  /**
   * Await process completion and return the exit code / signal.
   */
  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    const terminal = this.lookup(params.terminalId)
    const { exitCode, signal } = await terminal.exitPromise
    return { exitCode, signal }
  }

  // -----------------------------------------------------------------------
  // killTerminal
  // -----------------------------------------------------------------------

  /**
   * Send SIGTERM to a running terminal. Does NOT release the terminal id —
   * it remains queryable via `terminalOutput` and `waitForTerminalExit`.
   */
  async killTerminal(
    params: KillTerminalRequest,
  ): Promise<KillTerminalResponse> {
    const terminal = this.lookup(params.terminalId)
    terminal.process.kill('SIGTERM')
    return {}
  }

  // -----------------------------------------------------------------------
  // releaseTerminal
  // -----------------------------------------------------------------------

  /**
   * Kill the terminal (if still running) and remove it from the registry.
   * After release the terminal id is no longer valid.
   */
  async releaseTerminal(
    params: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse> {
    const terminal = this.lookup(params.terminalId)

    // Only kill if the process hasn't already exited
    if (!terminal.exited) {
      terminal.process.kill('SIGTERM')
    }

    this.terminals.delete(params.terminalId)
    return {}
  }

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  /**
   * Kill all managed terminals and clear the registry.
   * Safe to call even with zero terminals.
   */
  dispose(): void {
    for (const terminal of this.terminals.values()) {
      if (!terminal.exited) {
        terminal.process.kill('SIGTERM')
      }
    }
    this.terminals.clear()
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Look up a terminal by id, throwing if not found. */
  private lookup(terminalId: string): ManagedTerminal {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${terminalId}`)
    }
    return terminal
  }

  /**
   * Build an env object for spawn from the SDK's `EnvVariable` array.
   * Falls back to `process.env` merged with the provided vars.
   */
  private buildEnv(
    sdkEnv?: Array<{ name: string; value: string }>,
  ): Record<string, string> | undefined {
    if (!sdkEnv || sdkEnv.length === 0) return undefined
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >
    for (const { name, value } of sdkEnv) {
      env[name] = value
    }
    return env
  }
}
