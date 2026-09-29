import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AcpScanClient } from '@/lib/providers/transport/acp-client'
import type { AcpClientEvent } from '@/lib/providers/transport/acp-client'
import { FileSystemHandler } from '@/lib/providers/transport/file-system-handler'
import { TerminalHandler } from '@/lib/providers/transport/terminal-handler'
import { PermissionBridge } from '@/lib/providers/transport/permission-bridge'
import { SessionUpdateHandler } from '@/lib/providers/transport/session-update-handler'
import type { SessionNotification, Agent } from '@agentclientprotocol/sdk'
import type {
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  ReleaseTerminalRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'

/**
 * Test helpers: build a SessionNotification with the given update shape.
 */
function makeNotification(update: Record<string, unknown>): SessionNotification {
  return {
    sessionId: 'test-session',
    update: update as SessionNotification['update'],
  }
}

describe('AcpScanClient', () => {
  let fsHandler: FileSystemHandler
  let terminalHandler: TerminalHandler
  let permissionBridge: PermissionBridge
  let sessionUpdateHandler: SessionUpdateHandler
  let events: AcpClientEvent[]

  beforeEach(() => {
    fsHandler = new FileSystemHandler()
    terminalHandler = new TerminalHandler()
    permissionBridge = new PermissionBridge()
    sessionUpdateHandler = new SessionUpdateHandler()
    events = []
  })

  // ---- Construction ----

  it('implements Client from SDK (structural)', () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )
    // Must have required Client methods
    expect(typeof client.requestPermission).toBe('function')
    expect(typeof client.sessionUpdate).toBe('function')
  })

  it('accepts optional event callback in constructor options', () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )
    expect(client).toBeDefined()
  })

  // ---- setAgent ----

  it('setAgent stores agent reference', () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )
    const mockAgent = { initialize: vi.fn(), newSession: vi.fn() } as unknown as Agent
    client.setAgent(mockAgent)
    // No assertion on internal state — just verifying no throw
  })

  // ---- sessionUpdate: server_info event ----

  it('emits server_info event on session_info_update', async () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    const notification = makeNotification({
      sessionUpdate: 'session_info_update',
      title: 'Test Agent',
      updatedAt: '2025-01-15T10:30:00Z',
    })

    await client.sessionUpdate(notification)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('server_info')
    expect(events[0]).toMatchObject({
      type: 'server_info',
      agentId: 'test-session',
      agentVersion: 'Test Agent',
    })
  })

  // ---- sessionUpdate: done event on status completed ----

  it('emits done event when sessionUpdate status is "completed"', async () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    const notification = makeNotification({
      sessionUpdate: 'agent_message_chunk',
      status: 'completed',
    })

    await client.sessionUpdate(notification)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
  })

  it('does NOT emit done event for non-completed status', async () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    const notification = makeNotification({
      sessionUpdate: 'agent_message_chunk',
      status: 'in_progress',
    })

    await client.sessionUpdate(notification)

    // No done event — the notification type is unknown to SessionUpdateHandler
    expect(events).toHaveLength(0)
  })

  it('emits done event even when status completed on an unknown notification type', async () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    const notification = makeNotification({
      sessionUpdate: 'unknown_type' as SessionNotification['update']['sessionUpdate'],
      status: 'completed',
    })

    await client.sessionUpdate(notification)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
  })

  // ---- sessionUpdate: delegates to SessionUpdateHandler ----

  it('sessionUpdate delegates to SessionUpdateHandler.dispatch()', async () => {
    const dispatchSpy = vi.spyOn(sessionUpdateHandler, 'dispatch')

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    const notification = makeNotification({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Test Tool',
    })

    await client.sessionUpdate(notification)

    expect(dispatchSpy).toHaveBeenCalledWith(notification)
    // SessionUpdateHandler should produce a tool_call event
    expect(events.some((e) => e.type === 'tool_call')).toBe(true)
  })

  // ---- Delegation: writeTextFile → FileSystemHandler ----

  it('writeTextFile delegates to FileSystemHandler', async () => {
    const writeSpy = vi.spyOn(fsHandler, 'writeTextFile').mockResolvedValue({})

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: WriteTextFileRequest = {
      path: '/tmp/test.txt',
      content: 'hello world',
      sessionId: 's1',
    }

    const result: WriteTextFileResponse = await client.writeTextFile!(params)

    expect(writeSpy).toHaveBeenCalledWith(params)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({})
  })

  // ---- Delegation: readTextFile → FileSystemHandler ----

  it('readTextFile delegates to FileSystemHandler', async () => {
    const readSpy = vi.spyOn(fsHandler, 'readTextFile').mockResolvedValue({ content: 'hello' })

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: ReadTextFileRequest = {
      path: '/tmp/test.txt',
      line: 1,
      limit: 10,
      sessionId: 's1',
    }

    const result: ReadTextFileResponse = await client.readTextFile!(params)

    expect(readSpy).toHaveBeenCalledWith(params)
    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ content: 'hello' })
  })

  // ---- Delegation: createTerminal → TerminalHandler ----

  it('createTerminal delegates to TerminalHandler', async () => {
    const createSpy = vi.spyOn(terminalHandler, 'createTerminal').mockResolvedValue({
      terminalId: 'term-123',
    })

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: CreateTerminalRequest = {
      command: 'ls',
      args: ['-la'],
      cwd: '/tmp',
      sessionId: 's1',
    }

    const result: CreateTerminalResponse = await client.createTerminal!(params)

    expect(createSpy).toHaveBeenCalledWith(params)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ terminalId: 'term-123' })
  })

  // ---- Delegation: terminalOutput → TerminalHandler ----

  it('terminalOutput delegates to TerminalHandler', async () => {
    const outputSpy = vi.spyOn(terminalHandler, 'terminalOutput').mockResolvedValue({
      output: 'file1.txt\nfile2.txt',
      truncated: false,
      exitStatus: null,
    })

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: TerminalOutputRequest = {
      terminalId: 'term-123',
      sessionId: 's1',
    }

    const result: TerminalOutputResponse = await client.terminalOutput!(params)

    expect(outputSpy).toHaveBeenCalledWith(params)
    expect(outputSpy).toHaveBeenCalledTimes(1)
    expect(result.output).toBe('file1.txt\nfile2.txt')
  })

  // ---- Delegation: waitForTerminalExit → TerminalHandler ----

  it('waitForTerminalExit delegates to TerminalHandler', async () => {
    const waitSpy = vi.spyOn(terminalHandler, 'waitForTerminalExit').mockResolvedValue({
      exitCode: 0,
      signal: null,
    })

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: WaitForTerminalExitRequest = {
      terminalId: 'term-123',
      sessionId: 's1',
    }

    const result: WaitForTerminalExitResponse = await client.waitForTerminalExit!(params)

    expect(waitSpy).toHaveBeenCalledWith(params)
    expect(waitSpy).toHaveBeenCalledTimes(1)
    expect(result.exitCode).toBe(0)
  })

  // ---- Delegation: killTerminal → TerminalHandler ----

  it('killTerminal delegates to TerminalHandler', async () => {
    const killSpy = vi.spyOn(terminalHandler, 'killTerminal').mockResolvedValue({})

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: KillTerminalRequest = {
      terminalId: 'term-123',
      sessionId: 's1',
    }

    await client.killTerminal!(params)

    expect(killSpy).toHaveBeenCalledWith(params)
    expect(killSpy).toHaveBeenCalledTimes(1)
  })

  // ---- Delegation: releaseTerminal → TerminalHandler ----

  it('releaseTerminal delegates to TerminalHandler', async () => {
    const releaseSpy = vi.spyOn(terminalHandler, 'releaseTerminal').mockResolvedValue({})

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
    )

    const params: ReleaseTerminalRequest = {
      terminalId: 'term-123',
      sessionId: 's1',
    }

    await client.releaseTerminal!(params)

    expect(releaseSpy).toHaveBeenCalledWith(params)
    expect(releaseSpy).toHaveBeenCalledTimes(1)
  })

  // ---- Delegation: requestPermission → PermissionBridge ----

  it('requestPermission delegates to PermissionBridge', async () => {
    const permSpy = vi.spyOn(permissionBridge, 'requestPermission').mockRejectedValue(
      new Error('PermissionBridge not yet implemented'),
    )

    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { scanId: 'scan-1' },
    )

    const params: RequestPermissionRequest = {
      toolCallId: 'tc-1',
      options: [{ id: 'allow', kind: 'allow', name: 'Allow' }],
      sessionId: 's1',
    } as RequestPermissionRequest

    await expect(client.requestPermission(params)).rejects.toThrow(
      'PermissionBridge not yet implemented',
    )

    expect(permSpy).toHaveBeenCalledWith('scan-1', params)
    expect(permSpy).toHaveBeenCalledTimes(1)
  })

  // ---- Multiple events in one sessionUpdate ----

  it('emits multiple events when sessionUpdate dispatches to handler AND matches done condition', async () => {
    const client = new AcpScanClient(
      fsHandler,
      terminalHandler,
      permissionBridge,
      sessionUpdateHandler,
      { onEvent: (e) => events.push(e) },
    )

    // A session_info_update with status 'completed' should emit both server_info AND done
    const notification = makeNotification({
      sessionUpdate: 'session_info_update',
      title: 'Test Agent',
      status: 'completed',
    })

    await client.sessionUpdate(notification)

    // Two events: server_info from handler, done from status check
    expect(events).toHaveLength(2)
    expect(events.some((e) => e.type === 'server_info')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })
})
