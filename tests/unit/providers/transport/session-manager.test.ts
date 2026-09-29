import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before vi.mock(), used inside the factory.
// ---------------------------------------------------------------------------
const {
  mockSpawnLoginShell,
  mockConnectionConnect,
  MockConnectionManagerClass,
  mockConnectionCancelFn,
  mockConnectionNewSessionFn,
  mockConnectionPromptFn,
  mockConnectionAuthenticateFn,
  mockConnectionSignal,
  mockConnectionClosed,
  MockRequestError,
  mockSetSessionModeFn,
  mockUnstableSetSessionModelFn,
  mockPendingTurnQueueForScan,
  mockPendingTurnQueueCloseScan,
  mockQueueEnqueue,
  mockQueueNext,
  mockQueueIsEmpty,
  mockQueueDrain,
} = vi.hoisted(() => {
  const mockSpawnLoginShell = vi.fn()
  const mockConnectionConnect = vi.fn()
  const mockConnectionCancelFn = vi.fn().mockResolvedValue(undefined)
  const mockConnectionNewSessionFn = vi.fn()
  const mockConnectionPromptFn = vi.fn()
  const mockConnectionAuthenticateFn = vi.fn()
  const mockConnectionSignal = new AbortController().signal
  const mockConnectionClosed = Promise.resolve()
  const mockSetSessionModeFn = vi.fn().mockResolvedValue({})
  const mockUnstableSetSessionModelFn = vi.fn().mockResolvedValue({})

  // PendingTurnQueue mocks
  const mockQueueEnqueue = vi.fn()
  const mockQueueNext = vi.fn()
  const mockQueueIsEmpty = vi.fn().mockReturnValue(true)
  const mockQueueDrain = vi.fn()
  const mockPendingTurnQueueForScan = vi.fn().mockReturnValue({
    enqueue: mockQueueEnqueue,
    next: mockQueueNext,
    isEmpty: mockQueueIsEmpty,
    drain: mockQueueDrain,
  })
  const mockPendingTurnQueueCloseScan = vi.fn()

  /**
   * Proper class-based mock for ConnectionManager so `new ConnectionManager()`
   * works in the implementation. Arrow functions are not constructors.
   */
  class MockConnectionManagerClass {
    connect = mockConnectionConnect
    getConnection = vi.fn()
    removeConnection = vi.fn()
    dispose = vi.fn()
  }

  /** Fake RequestError class matching the SDK's static builders. */
  class MockRequestError extends Error {
    code: number
    data?: unknown

    constructor(code: number, message: string, data?: unknown) {
      super(message)
      this.code = code
      this.data = data
    }

    static authRequired(data?: unknown, message?: string): MockRequestError {
      return new MockRequestError(-32000, message ?? 'Authentication required', data)
    }
  }

  return {
    mockSpawnLoginShell,
    mockConnectionConnect,
    MockConnectionManagerClass,
    mockConnectionCancelFn,
    mockConnectionNewSessionFn,
    mockConnectionPromptFn,
    mockConnectionAuthenticateFn,
    mockConnectionSignal,
    mockConnectionClosed,
    MockRequestError,
    mockSetSessionModeFn,
    mockUnstableSetSessionModelFn,
    mockPendingTurnQueueForScan,
    mockPendingTurnQueueCloseScan,
    mockQueueEnqueue,
    mockQueueNext,
    mockQueueIsEmpty,
    mockQueueDrain,
  }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/providers/transport/spawn-shell', () => ({
  spawnLoginShell: mockSpawnLoginShell,
}))

vi.mock('@/lib/providers/transport/connection-manager', () => ({
  ConnectionManager: MockConnectionManagerClass,
}))

vi.mock('@agentclientprotocol/sdk', () => ({
  RequestError: MockRequestError,
  PROTOCOL_VERSION: 1,
}))

vi.mock('@/lib/providers/transport/traffic-logger', () => ({
  logTraffic: vi.fn(),
}))

vi.mock('@/lib/providers/transport/pending-turn-queue', () => ({
  forScan: mockPendingTurnQueueForScan,
  closeScan: mockPendingTurnQueueCloseScan,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { AgentDef } from '@/lib/providers/cli/agents'
import type { ScanOpts, ProviderEvent } from '@/lib/providers/index'

/** Minimal valid AgentDef for testing */
function makeAgentDef(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    bin: 'test-bin',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream' as const,
    transport: 'acp' as const,
    acpArgs: ['--acp'],
    buildArgs: () => [],
    ...overrides,
  }
}

/** Minimal valid ScanOpts for testing */
function makeScanOpts(overrides: Partial<ScanOpts> = {}): ScanOpts {
  return {
    targetPath: '/tmp/test-project',
    ...overrides,
  }
}

/**
 * Build a fake `SpawnResult` returned by the `spawnLoginShell` mock.
 */
function makeFakeSpawnResult(
  overrides: {
    exitCode?: number | null
    exitSignal?: string | null
    stderr?: string
  } = {},
) {
  const { exitCode = 0, exitSignal = null, stderr = '' } = overrides

  const killSpy = vi.fn()
  const process = {
    pid: 12345,
    on: vi.fn(),
    once: vi.fn(),
    kill: vi.fn(),
  }

  let resolveExited!: (value: { code: number | null; signal: string | null }) => void
  const exited = new Promise<{ code: number | null; signal: string | null }>((r) => {
    resolveExited = r
  })

  return {
    spawnResult: {
      process: process as any,
      stdout: (async function* () { /* no-op */ })(),
      stderr: (async function* () { if (stderr) yield stderr })(),
      exited,
      kill: killSpy,
    },
    killSpy,
    processKill: process.kill,
    resolveExited: () => resolveExited({ code: exitCode, signal: exitSignal }),
  }
}

/**
 * Build a fake connection object returned by ConnectionManager.connect().
 * Each call resets the mock state to a clean slate.
 */
function makeFakeConnection() {
  mockConnectionNewSessionFn.mockReset()
  mockConnectionPromptFn.mockReset()
  mockConnectionAuthenticateFn.mockReset()
  mockConnectionCancelFn.mockReset()

  mockConnectionNewSessionFn.mockResolvedValue({ sessionId: 'sess-001' })
  mockConnectionCancelFn.mockResolvedValue(undefined)
  mockConnectionAuthenticateFn.mockResolvedValue({})
  mockSetSessionModeFn.mockReset()
  mockUnstableSetSessionModelFn.mockReset()
  mockSetSessionModeFn.mockResolvedValue({})
  mockUnstableSetSessionModelFn.mockResolvedValue({})

  return {
    connection: {
      newSession: mockConnectionNewSessionFn,
      prompt: mockConnectionPromptFn,
      authenticate: mockConnectionAuthenticateFn,
      cancel: mockConnectionCancelFn,
      setSessionMode: mockSetSessionModeFn,
      unstable_setSessionModel: mockUnstableSetSessionModelFn,
      signal: mockConnectionSignal,
      closed: mockConnectionClosed,
    },
    client: {
      setAgent: vi.fn(),
      onEvent: undefined as ((event: any) => void) | undefined,
    },
  }
}

/**
 * Wire mocks for a successful happy-path scan:
 * - spawn returns a normal process
 * - connect returns connection + client with onEvent
 * - newSession succeeds
 * - prompt resolves with "end_turn"
 */
function setupHappyPath() {
  const { spawnResult, killSpy, resolveExited } = makeFakeSpawnResult()
  mockSpawnLoginShell.mockReturnValue(spawnResult)

  const { connection, client } = makeFakeConnection()
  mockConnectionConnect.mockReset()
  mockConnectionConnect.mockResolvedValue({ connection, client })

  // prompt resolves normally
  mockConnectionPromptFn.mockResolvedValue({ stopReason: 'end_turn' })

  return { spawnResult, killSpy, resolveExited, connection, client }
}

// ---------------------------------------------------------------------------
// Import SessionManager after mocks are set up
// ---------------------------------------------------------------------------
import { SessionManager } from '@/lib/providers/transport/session-manager'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionManager', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockConnectionConnect.mockReset()
    sessionManager = new SessionManager()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // Happy Path
  // -----------------------------------------------------------------------
  describe('run() — happy path', () => {
    it('calls spawnLoginShell with the agent bin, acpArgs, cwd, and env', async () => {
      const agent = makeAgentDef({ bin: 'codex', acpArgs: ['--acp', '--verbose'] })
      const opts = makeScanOpts({ targetPath: '/workspace/myproj' })
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan this repo', opts)) {
        events.push(event)
      }

      expect(mockSpawnLoginShell).toHaveBeenCalledTimes(1)
      const [bin, args, spawnOpts] = mockSpawnLoginShell.mock.calls[0]
      expect(bin).toBe('codex')
      expect(args).toEqual(['--acp', '--verbose'])
      expect(spawnOpts.cwd).toBe('/workspace/myproj')
    })

    it('calls ConnectionManager.connect() with the agent id and child process stdio', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(mockConnectionConnect).toHaveBeenCalledTimes(1)
      const [agentId, child] = mockConnectionConnect.mock.calls[0]
      expect(agentId).toBe('test-agent')
      expect(child).toHaveProperty('stdout')
      expect(child).toHaveProperty('stdin')
    })

    it('calls connection.newSession() with cwd and empty mcpServers', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts({ targetPath: '/repo/path' })
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(mockConnectionNewSessionFn).toHaveBeenCalledTimes(1)
      const nsArg = mockConnectionNewSessionFn.mock.calls[0][0]
      expect(nsArg.cwd).toBe('/repo/path')
      expect(nsArg.mcpServers).toEqual([])
    })

    it('calls connection.prompt() with sessionId and prompt text', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'find bugs', opts)) {
        events.push(event)
      }

      expect(mockConnectionPromptFn).toHaveBeenCalledTimes(1)
      const promptArg = mockConnectionPromptFn.mock.calls[0][0]
      expect(promptArg.sessionId).toBe('sess-001')
      expect(promptArg.prompt).toEqual([{ type: 'text', text: 'find bugs' }])
    })

    it('yields a done event when prompt completes with end_turn', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      const doneEvents = events.filter((e) => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
    })

    it('yields a done event when onEvent dispatches a done event during streaming', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // prompt stays pending until we resolve it
      let resolvePrompt!: (value: unknown) => void
      mockConnectionPromptFn.mockReturnValue(new Promise((r) => { resolvePrompt = r }))

      const scanPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts)) {
          events.push(event)
        }
        return events
      })()

      // Wait for connect to settle so onEvent is wired.
      // The client object is the same reference — after connect resolves,
      // SessionManager sets client.onEvent.
      await vi.waitFor(() => {
        expect(mockConnectionConnect).toHaveBeenCalled()
      })

      // Let microtasks flush so SessionManager's await resolves and onEvent is set
      await new Promise((r) => setTimeout(r, 50))

      const onEvent = client.onEvent
      expect(onEvent).toBeDefined()
      expect(typeof onEvent).toBe('function')

      // Dispatch a done event through onEvent
      onEvent!({ type: 'done' })

      // Resolve prompt
      resolvePrompt({ stopReason: 'end_turn' })

      const events = await scanPromise
      const doneEvents = events.filter((e) => e.type === 'done')
      expect(doneEvents.length).toBeGreaterThanOrEqual(1)
    })

    it('kills the spawned process in the finally block on normal completion', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { killSpy } = setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(killSpy).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Non-zero exit before session/new
  // -----------------------------------------------------------------------
  describe('run() — non-zero exit before session/new', () => {
    it('yields an error event when the child exits with code 1 before session is created', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult, resolveExited } = makeFakeSpawnResult({
        exitCode: 1,
        stderr: 'Error: agent not found\n',
      })
      mockSpawnLoginShell.mockReturnValue(spawnResult)

      // Make connect hang — never resolves (process exits before we connect)
      mockConnectionConnect.mockReturnValue(new Promise(() => {}))

      const runPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts)) {
          events.push(event)
        }
        return events
      })()

      // Wait for spawn to be called
      await vi.waitFor(() => {
        expect(mockSpawnLoginShell).toHaveBeenCalled()
      })

      // Resolve exited with non-zero — the earlyExitPromise should win the race
      resolveExited()

      const events = await runPromise
      const errorEvents = events.filter((e) => e.type === 'error')
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0].type).toBe('error')
      expect(errorEvents[0].message).toContain('code 1')
    })

    it('kills the process in the finally block even after error exit', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult, killSpy, resolveExited } = makeFakeSpawnResult({
        exitCode: 1,
      })
      mockSpawnLoginShell.mockReturnValue(spawnResult)

      // Throw on connect to trigger error path
      mockConnectionConnect.mockRejectedValue(new Error('Connection failed'))

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(killSpy).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // AbortSignal
  // -----------------------------------------------------------------------
  describe('run() — AbortSignal', () => {
    it('calls connection.cancel() when the abort signal fires', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const controller = new AbortController()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // Hang prompt forever
      mockConnectionPromptFn.mockReturnValue(new Promise(() => {}))

      const runPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts, controller.signal)) {
          events.push(event)
        }
        return events
      })()

      // Wait for newSession to be called
      await vi.waitFor(() => {
        expect(mockConnectionNewSessionFn).toHaveBeenCalled()
      })

      // Fire the abort signal
      controller.abort()

      await runPromise

      // connection.cancel() should have been called
      expect(mockConnectionCancelFn).toHaveBeenCalled()
    })

    it('kills the spawned process when abort signal fires', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const controller = new AbortController()
      const { spawnResult, killSpy } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // Hang prompt
      mockConnectionPromptFn.mockReturnValue(new Promise(() => {}))

      const runPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts, controller.signal)) {
          events.push(event)
        }
        return events
      })()

      await vi.waitFor(() => {
        expect(mockConnectionPromptFn).toHaveBeenCalled()
      })

      controller.abort()

      await runPromise

      // process.kill() must have been called in finally
      expect(killSpy).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Auth retry on -32000
  // -----------------------------------------------------------------------
  describe('run() — auth retry on -32000', () => {
    it('calls connection.authenticate() then retries newSession on -32000 error', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult, killSpy } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // First newSession call throws auth error, second succeeds
      mockConnectionNewSessionFn.mockReset()
      mockConnectionNewSessionFn
        .mockRejectedValueOnce(new MockRequestError(-32000, 'Authentication required'))
        .mockResolvedValueOnce({ sessionId: 'sess-auth' })

      mockConnectionAuthenticateFn.mockResolvedValue({})
      mockConnectionPromptFn.mockResolvedValue({ stopReason: 'end_turn' })

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      // authenticate was called
      expect(mockConnectionAuthenticateFn).toHaveBeenCalledTimes(1)
      // newSession was called twice (first failed, second succeeded)
      expect(mockConnectionNewSessionFn).toHaveBeenCalledTimes(2)
      // prompt was called with the retried session id
      expect(mockConnectionPromptFn).toHaveBeenCalledTimes(1)
      expect(mockConnectionPromptFn.mock.calls[0][0].sessionId).toBe('sess-auth')
    })

    it('propagates non-32000 errors without retry', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // Throw a non-auth error
      mockConnectionNewSessionFn.mockReset()
      mockConnectionNewSessionFn.mockRejectedValue(new Error('Connection refused'))

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      const errorEvents = events.filter((e) => e.type === 'error')
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        message: expect.stringContaining('Connection refused') as string,
      })

      // authenticate should NOT be called
      expect(mockConnectionAuthenticateFn).not.toHaveBeenCalled()
      // newSession should be called exactly once (not retried)
      expect(mockConnectionNewSessionFn).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Process leak prevention
  // -----------------------------------------------------------------------
  describe('run() — process leak prevention', () => {
    it('kills the spawned process in finally even when connect throws', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult, killSpy } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)

      // connect throws immediately
      mockConnectionConnect.mockRejectedValue(new Error('Port already in use'))

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(killSpy).toHaveBeenCalledTimes(1)
    })

    it('kills the spawned process in finally even when newSession throws', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult, killSpy } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      mockConnectionNewSessionFn.mockReset()
      mockConnectionNewSessionFn.mockRejectedValue(new Error('Session creation failed'))

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(killSpy).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // SessionNotification forwarding
  // -----------------------------------------------------------------------
  describe('run() — sessionUpdate forwarding', () => {
    it('dispatches sessionUpdate events through onEvent callback', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // Keep prompt pending so we can observe session updates first
      let resolvePrompt!: (value: unknown) => void
      mockConnectionPromptFn.mockReturnValue(new Promise((r) => { resolvePrompt = r }))

      const scanPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts)) {
          events.push(event)
        }
        return events
      })()

      await vi.waitFor(() => {
        expect(mockConnectionPromptFn).toHaveBeenCalled()
      })

      // Let microtasks flush so the generator enters the awaiting state
      await new Promise((r) => setTimeout(r, 50))

      // Access the wired onEvent on the same client object reference
      const onEvent = client.onEvent
      expect(onEvent).toBeDefined()

      // Dispatch various session update events through onEvent,
      // yielding to the event loop between each so the generator can
      // yield each event to the consumer before we push the next.
      onEvent!({ type: 'tool_call', toolCallId: 'tc1', title: 'Read file' })
      await new Promise((r) => setTimeout(r, 0))

      onEvent!({ type: 'server_info', agentName: 'Test' })
      await new Promise((r) => setTimeout(r, 0))

      onEvent!({ type: 'cost', totalUsd: 0.05 })
      await new Promise((r) => setTimeout(r, 0))

      // Resolve prompt (triggers done in the stream)
      resolvePrompt({ stopReason: 'end_turn' })

      const events = await scanPromise

      const toolCalls = events.filter((e) => e.type === 'tool_call')
      const serverInfos = events.filter((e) => e.type === 'server_info')
      const costs = events.filter((e) => e.type === 'cost')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]).toMatchObject({ type: 'tool_call', toolCallId: 'tc1', title: 'Read file' })
      expect(serverInfos).toHaveLength(1)
      expect(costs).toHaveLength(1)
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe('run() — error handling', () => {
    it('emits an error event when spawnLoginShell throws synchronously', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      mockSpawnLoginShell.mockImplementation(() => {
        throw new Error('Shell not available')
      })

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      const errorEvents = events.filter((e) => e.type === 'error')
      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0]).toMatchObject({
        type: 'error',
        message: 'Shell not available',
      })
    })
  })

  // -----------------------------------------------------------------------
  // setMode / setModel
  // -----------------------------------------------------------------------
  describe('setMode()', () => {
    it('delegates to connection.setSessionMode() with sessionId and modeId', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { connection, client } = makeFakeConnection()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      mockConnectionConnect.mockResolvedValue({ connection, client })
      mockConnectionPromptFn.mockResolvedValue({ stopReason: 'end_turn' })

      // Run a scan so the session is created and stored
      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      // Now set a mode on the session
      await sessionManager.setMode('sess-001', 'code')

      expect(mockSetSessionModeFn).toHaveBeenCalledTimes(1)
      expect(mockSetSessionModeFn).toHaveBeenCalledWith({
        sessionId: 'sess-001',
        modeId: 'code',
      })
    })

    it('is a no-op for unknown sessionId (does not throw)', async () => {
      await expect(sessionManager.setMode('nonexistent', 'code')).resolves.toBeUndefined()
      expect(mockSetSessionModeFn).not.toHaveBeenCalled()
    })
  })

  describe('setModel()', () => {
    it('delegates to connection.unstable_setSessionModel() with sessionId and modelId', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { connection, client } = makeFakeConnection()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      mockConnectionConnect.mockResolvedValue({ connection, client })
      mockConnectionPromptFn.mockResolvedValue({ stopReason: 'end_turn' })

      // Run a scan so the session is created and stored
      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      // Now set a model on the session
      await sessionManager.setModel('sess-001', 'claude-sonnet-4-5')

      expect(mockUnstableSetSessionModelFn).toHaveBeenCalledTimes(1)
      expect(mockUnstableSetSessionModelFn).toHaveBeenCalledWith({
        sessionId: 'sess-001',
        modelId: 'claude-sonnet-4-5',
      })
    })

    it('is a no-op for unknown sessionId (does not throw)', async () => {
      await expect(sessionManager.setModel('nonexistent', 'gpt-4o')).resolves.toBeUndefined()
      expect(mockUnstableSetSessionModelFn).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // v0.3: PendingTurnQueue integration
  // -----------------------------------------------------------------------
  describe('run() — PendingTurnQueue integration', () => {
    it('calls forScan() to acquire the queue during the scan lifecycle', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      // forScan should be called with a string (the session/scan id)
      expect(mockPendingTurnQueueForScan).toHaveBeenCalledWith(expect.any(String))
    })

    it('calls closeScan(scanId) in the finally block after scan completes', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      setupHappyPath()

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(mockPendingTurnQueueCloseScan).toHaveBeenCalledOnce()
    })

    it('calls closeScan in the finally block even when connect throws', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)

      mockConnectionConnect.mockRejectedValue(new Error('Connection failed'))

      const events: ProviderEvent[] = []
      for await (const event of sessionManager.run(agent, 'scan', opts)) {
        events.push(event)
      }

      expect(mockPendingTurnQueueCloseScan).toHaveBeenCalledOnce()
    })

    it('calls closeScan when the abort signal fires', async () => {
      const agent = makeAgentDef()
      const opts = makeScanOpts()
      const controller = new AbortController()
      const { spawnResult } = makeFakeSpawnResult()
      mockSpawnLoginShell.mockReturnValue(spawnResult)
      const { connection, client } = makeFakeConnection()
      mockConnectionConnect.mockResolvedValue({ connection, client })

      // Hang prompt forever
      mockConnectionPromptFn.mockReturnValue(new Promise(() => {}))

      const runPromise = (async () => {
        const events: ProviderEvent[] = []
        for await (const event of sessionManager.run(agent, 'scan', opts, controller.signal)) {
          events.push(event)
        }
        return events
      })()

      await vi.waitFor(() => {
        expect(mockConnectionNewSessionFn).toHaveBeenCalled()
      })

      controller.abort()
      await runPromise

      expect(mockPendingTurnQueueCloseScan).toHaveBeenCalledOnce()
    })
  })
})
