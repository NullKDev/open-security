import { Readable, Writable } from 'node:stream'
import { logTraffic } from './traffic-logger'
import { AcpScanClient } from './acp-client'
import { FileSystemHandler } from './file-system-handler'
import { TerminalHandler } from './terminal-handler'
import { SessionUpdateHandler } from './session-update-handler'
import { getPermissionBridge } from './permission-bridge'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type { Agent, Stream } from '@agentclientprotocol/sdk'
import type { InitializeResponse } from '@agentclientprotocol/sdk'

/** Client name sent in the ACP initialize handshake. */
const CLIENT_NAME = 'open-security'

/** Client version sent in the ACP initialize handshake. */
const CLIENT_VERSION = '0.1.0'

/**
 * Wrap a Stream to intercept and log all messages in both directions.
 *
 * Creates two TransformStreams:
 * - `sendTap`: logs outgoing messages (client → agent)
 * - `recvTap`: logs incoming messages (agent → client)
 *
 * Both taps are wired via `pipeTo` so they process traffic in the
 * background without blocking the main stream.
 *
 * Returns a new Stream whose writable feeds into sendTap and whose
 * readable comes from recvTap — the caller uses this as the final
 * stream for ClientSideConnection.
 */
function tapStream(stream: Stream): Stream {
  // Tap outgoing messages (client → agent)
  const sendTap = new TransformStream({
    transform(chunk, controller) {
      try { logTraffic('send', chunk) } catch { /* best-effort */ }
      controller.enqueue(chunk)
    },
  })

  // Tap incoming messages (agent → client)
  const recvTap = new TransformStream({
    transform(chunk, controller) {
      try { logTraffic('recv', chunk) } catch { /* best-effort */ }
      controller.enqueue(chunk)
    },
  })

  void sendTap.readable.pipeTo(stream.writable).catch(() => {})
  void stream.readable.pipeTo(recvTap.writable).catch(() => {})

  return {
    writable: sendTap.writable,
    readable: recvTap.readable,
  } as Stream
}

/**
 * Holds the connection and client reference for a connected agent.
 */
export interface ConnectionInfo {
  /** The ACP ClientSideConnection wrapping the agent's ndjson stream. */
  connection: ClientSideConnection
  /** The AcpScanClient handling agent → client requests. */
  client: AcpScanClient
  /** The response from the ACP initialize handshake (agent info, capabilities, auth methods). */
  initResponse: InitializeResponse
}

/**
 * Manages ACP transport connections for spawned agent processes.
 *
 * For each agent process, converts Node.js `Readable`/`Writable` stdio
 * streams to Web Streams (`Readable.toWeb()` / `Writable.toWeb()`),
 * builds an ndJsonStream, constructs a `ClientSideConnection`, and
 * initializes the protocol handshake.
 *
 * Connections are tracked in an internal map keyed by `agentId` so
 * other modules (e.g. SessionManager, permission routes) can look
 * them up at runtime.
 */
export class ConnectionManager {
  /** Map of agentId → ConnectionInfo for all active connections. */
  private connections = new Map<string, ConnectionInfo>()

  /**
   * Connect to an agent process.
   *
   * Converts the child process's stdio to Web Streams, creates an
   * ndJsonStream + ClientSideConnection, initialises the protocol
   * with client info and capabilities, and stores the connection
   * for later retrieval.
   *
   * @param agentId - Unique identifier for this agent instance
   * @param child - The spawned child process
   * @returns The connection info containing both the connection and client
   */
  async connect(
    agentId: string,
    child: {
      stdout: NodeJS.ReadableStream
      stdin: NodeJS.WritableStream
      stderr?: NodeJS.ReadableStream
    },
  ): Promise<ConnectionInfo> {
    // Convert Node.js streams to Web Streams.
    // Double cast through unknown is required because Readable.toWeb()
    // returns ReadableStream<any> which TypeScript considers insufficiently
    // overlapping with ReadableStream<Uint8Array> for a direct cast.
    const readable = Readable.toWeb(child.stdout as Readable) as unknown as ReadableStream<Uint8Array>
    const writable = Writable.toWeb(child.stdin as Writable) as unknown as WritableStream<Uint8Array>

    // Build the ACP ndjson stream from the Web streams
    const rawStream: Stream = ndJsonStream(writable, readable)

    // Insert bidirectional traffic taps (send + recv) for debug logging
    const stream = tapStream(rawStream)

    // Create the client-side connection, wiring our AcpScanClient as the
    // handler for agent → client requests
    const client = new AcpScanClient(
      new FileSystemHandler(),
      new TerminalHandler(),
      getPermissionBridge(),
      new SessionUpdateHandler(),
      {
        scanId: agentId,
        onEvent: () => {
          // Placeholder — SessionManager will wire the real event callback
        },
      },
    )

    const connection = new ClientSideConnection(
      // Factory: receives the Agent proxy from ClientSideConnection and stores
      // it on the client so reverse-direction calls (client → agent) work.
      (agent: Agent) => {
        client.setAgent(agent)
        return client
      },
      stream,
    )

    // Initialise the protocol: version negotiation + capability advertisement
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: CLIENT_NAME,
        version: CLIENT_VERSION,
      },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    })

    const info: ConnectionInfo = { connection, client, initResponse }
    this.connections.set(agentId, info)

    return info
  }

  /**
   * Look up an active connection by agent ID.
   *
   * @param agentId - The agent identifier used during `connect()`
   * @returns The connection info, or `undefined` if no such connection exists
   */
  getConnection(agentId: string): ConnectionInfo | undefined {
    return this.connections.get(agentId)
  }

  /**
   * Remove a connection from the internal map without tearing down the
   * underlying process. Use this when the connection lifecycle is managed
   * externally (e.g. SessionManager handles `connection.cancel()`).
   *
   * @param agentId - The agent identifier to remove
   */
  removeConnection(agentId: string): void {
    this.connections.delete(agentId)
  }

  /**
   * Dispose all tracked connections. Does NOT kill processes — that
   * responsibility belongs to the process owner (spawn-shell.ts).
   *
   * Call this during scan teardown to prevent stale lookups.
   */
  dispose(): void {
    this.connections.clear()
  }
}
