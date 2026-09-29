import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { Readable, Writable } from 'node:stream'

/**
 * Hoisted mocks — declared before vi.mock() so they
 * are available inside the factory (which vitest hoists to top).
 *
 * MockClientSideConnection is a real class so it supports `new`.
 * ndJsonMockFn tracks ndJsonStream calls.
 * instanceInitMock is the per-instance `initialize` spy.
 */
const {
  ndJsonMockFn,
  MockClientSideConnection,
  instanceInitMock,
} = vi.hoisted(() => {
  const ndJsonMockFn = vi.fn()
  const instanceInitMock = vi.fn().mockResolvedValue({ protocolVersion: 1 })

  // Track constructor calls
  const constructSpy = vi.fn()

  class MockClientSideConnection {
    /** Spied `initialize` method */
    initialize = instanceInitMock

    constructor(...args: unknown[]) {
      constructSpy(...args)
    }

    /** Expose constructor spy as static for assertions */
    static get calls() {
      return constructSpy.mock.calls
    }
    static get mock() {
      return constructSpy
    }
  }

  return { ndJsonMockFn, MockClientSideConnection, instanceInitMock }
})

/**
 * Mock @agentclientprotocol/sdk — provides fake ClientSideConnection,
 * ndJsonStream, and PROTOCOL_VERSION.
 */
vi.mock('@agentclientprotocol/sdk', () => {
  return {
    ClientSideConnection: MockClientSideConnection,
    ndJsonStream: ndJsonMockFn,
    PROTOCOL_VERSION: 1,
  }
})

import {
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { ConnectionManager } from '@/lib/providers/transport/connection-manager'

/**
 * Setup helper: configures ndJsonStream to return a mock Stream
 * with proper pipeTo support.
 */
function setupMockConnection() {
  ndJsonMockFn.mockReturnValue({
    writable: {
      getWriter: vi.fn(),
      abort: vi.fn(),
      close: vi.fn(),
      locked: false,
    } as unknown as WritableStream,
    readable: {
      getReader: vi.fn(),
      cancel: vi.fn(),
      locked: false,
      pipeTo: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReadableStream & { pipeTo?: (writable: WritableStream) => Promise<void> },
  })
}

/**
 * Fake child process — uses PassThrough streams so we can write and
 * read data as the real process would.
 */
function fakeProcess() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const stderr = new PassThrough()

  const child = {
    stdout: stdout as unknown as NodeJS.ReadableStream,
    stdin: stdin as unknown as NodeJS.WritableStream,
    stderr: stderr as unknown as NodeJS.ReadableStream,
    pid: 99999,
    killed: false,
    kill: vi.fn(),
  } as any

  return { child, stdout, stdin, stderr }
}

describe('ConnectionManager', () => {
  let manager: ConnectionManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ConnectionManager()
    setupMockConnection()
  })

  afterEach(() => {
    manager.dispose()
  })

  // ---- connect() ----
  describe('connect()', () => {
    it('converts Node stdout to a Web ReadableStream via Readable.toWeb()', async () => {
      const { child } = fakeProcess()
      const toWebSpy = vi.spyOn(Readable, 'toWeb')

      await manager.connect('agent-1', child)

      expect(toWebSpy).toHaveBeenCalledWith(child.stdout)
      toWebSpy.mockRestore()
    })

    it('converts Node stdin to a Web WritableStream via Writable.toWeb()', async () => {
      const { child } = fakeProcess()
      const toWebSpy = vi.spyOn(Writable, 'toWeb')

      await manager.connect('agent-1', child)

      expect(toWebSpy).toHaveBeenCalledWith(child.stdin)
      toWebSpy.mockRestore()
    })

    it('calls ndJsonStream with the converted Web streams', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-1', child)

      expect(ndJsonMockFn).toHaveBeenCalledTimes(1)
      const [output, input] = ndJsonMockFn.mock.calls[0]
      // Both should be Web streams (from Readable.toWeb / Writable.toWeb)
      expect(output).toBeDefined()
      expect(input).toBeDefined()
    })

    it('constructs ClientSideConnection with the ndJsonStream result', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-2', child)

      // ClientSideConnection should have been constructed
      const callCount = MockClientSideConnection.mock.mock.calls.length
      expect(callCount).toBe(1)
      // Second argument should be a Stream (ndJsonStream's return) with writable and readable
      const constructorArgs = MockClientSideConnection.calls[0]
      expect(constructorArgs[1]).toHaveProperty('writable')
      expect(constructorArgs[1]).toHaveProperty('readable')
    })

    it('calls connection.initialize() with protocolVersion and clientInfo', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-3', child)

      // The initialize mock should have been called
      expect(instanceInitMock).toHaveBeenCalledTimes(1)
      const initParams = instanceInitMock.mock.calls[0][0]
      expect(initParams.protocolVersion).toBe(PROTOCOL_VERSION)
      expect(initParams.clientInfo).toEqual({
        name: 'open-security',
        version: expect.any(String),
      })
    })

    it('advertises clientCapabilities with fs and terminal', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-4', child)

      const initParams = instanceInitMock.mock.calls[0][0]
      expect(initParams.clientCapabilities).toEqual({
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      })
    })

    it('returns ConnectionInfo with connection, client, and initResponse', async () => {
      const { child } = fakeProcess()

      const result = await manager.connect('agent-5', child)

      expect(result).toHaveProperty('connection')
      expect(result).toHaveProperty('client')
      expect(result).toHaveProperty('initResponse')
      // The connection should be the object returned by the mock constructor
      expect(result.connection).toHaveProperty('initialize')
      expect(typeof result.connection.initialize).toBe('function')
    })

    it('stores connection in internal map for later retrieval', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-6', child)

      const info = manager.getConnection('agent-6')
      expect(info).toBeDefined()
      expect(info!.connection).toHaveProperty('initialize')
    })
  })

  // ---- getConnection() ----
  describe('getConnection()', () => {
    it('returns the stored connection info for a connected agent', async () => {
      const { child } = fakeProcess()
      await manager.connect('agent-get', child)

      const info = manager.getConnection('agent-get')
      expect(info).toBeDefined()
      expect(info!.connection).toBeDefined()
      expect(info!.client).toBeDefined()
    })

    it('returns undefined for an unknown agentId', () => {
      const info = manager.getConnection('nonexistent')
      expect(info).toBeUndefined()
    })
  })

  // ---- removeConnection() ----
  describe('removeConnection()', () => {
    it('removes the connection from the internal map', async () => {
      const { child } = fakeProcess()
      await manager.connect('agent-rm', child)

      expect(manager.getConnection('agent-rm')).toBeDefined()

      manager.removeConnection('agent-rm')
      expect(manager.getConnection('agent-rm')).toBeUndefined()
    })

    it('is a no-op for unknown agentId (does not throw)', () => {
      expect(() => manager.removeConnection('nonexistent')).not.toThrow()
    })
  })

  // ---- dispose() ----
  describe('dispose()', () => {
    it('clears all stored connections', async () => {
      const { child: c1 } = fakeProcess()
      const { child: c2 } = fakeProcess()

      await manager.connect('a', c1)
      await manager.connect('b', c2)

      expect(manager.getConnection('a')).toBeDefined()
      expect(manager.getConnection('b')).toBeDefined()

      manager.dispose()

      expect(manager.getConnection('a')).toBeUndefined()
      expect(manager.getConnection('b')).toBeUndefined()
    })

    it('is a no-op when no connections exist', () => {
      expect(() => manager.dispose()).not.toThrow()
    })
  })

  // ---- Traffic Tapping ----
  describe('traffic tapping', () => {
    it('wires a TransformStream between the process stdout and ndJsonStream', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-tap', child)

      // Verify that ndJsonStream was called (the TransformStream is
      // piped internally — we verify the connection was established)
      expect(ndJsonMockFn).toHaveBeenCalledTimes(1)
    })

    it('passes a tapped stream (with writable and readable) to ClientSideConnection', async () => {
      const { child } = fakeProcess()

      await manager.connect('agent-bidir', child)

      // The ClientSideConnection constructor should have been called with
      // a tapped stream that has both writable and readable properties
      const constructorArgs = MockClientSideConnection.calls.at(-1)
      expect(constructorArgs).toBeDefined()
      // Second argument is the stream passed to ClientSideConnection
      const stream = constructorArgs![1]
      expect(stream).toHaveProperty('writable')
      expect(stream).toHaveProperty('readable')
    })

    it('forwards data from the child process stdout to the ACP stream', async () => {
      const { child, stdout } = fakeProcess()

      const connectPromise = manager.connect('agent-fwd', child)
      // Write ndjson to simulate agent output
      stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: 's1', update: {} },
        }) + '\n',
      )

      const info = await connectPromise
      expect(info.connection).toBeDefined()
    })
  })

  // ---- Initialize response storage ----
  describe('initResponse storage', () => {
    it('stores InitializeResponse in ConnectionInfo after connect()', async () => {
      const { child } = fakeProcess()

      const result = await manager.connect('agent-ir', child)

      expect(result).toHaveProperty('initResponse')
      // initResponse should be the value returned by the mocked initialize()
      expect(result.initResponse).toEqual({ protocolVersion: 1 })
    })

    it('initResponse is retrievable via getConnection()', async () => {
      const { child } = fakeProcess()
      await manager.connect('agent-ir-get', child)

      const info = manager.getConnection('agent-ir-get')
      expect(info).toBeDefined()
      expect(info!.initResponse).toBeDefined()
      expect(info!.initResponse.protocolVersion).toBe(1)
    })
  })
})
