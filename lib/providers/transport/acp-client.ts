/**
 * AcpScanClient — Client-side implementation of the ACP `Client` interface.
 *
 * Wires together four handlers to satisfy agent requests:
 * - `SessionUpdateHandler` — converts `sessionUpdate` notifications into typed events
 * - `FileSystemHandler`   — read/write text files via `fs/promises`
 * - `TerminalHandler`     — spawn and manage shell commands
 * - `PermissionBridge`    — pending-promise registry for permission requests
 *
 * The class implements `Client` from `@agentclientprotocol/sdk` and is passed
 * to `ClientSideConnection`'s `toClient` factory. When an agent calls a method
 * on this client, it delegates to the appropriate handler.
 *
 * Events emitted via the optional `onEvent` callback:
 *  - All events produced by `SessionUpdateHandler.dispatch()`
 *  - `done` — synthetic event emitted when any `sessionUpdate` carries
 *    `status === "completed"` (session finished).
 *
 * @module acp-client
 */
import type {
  Client,
  Agent,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
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
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
} from '@agentclientprotocol/sdk'
import type {
  SessionUpdateHandlerEvent,
} from './session-update-handler'
import { SessionUpdateHandler } from './session-update-handler'
import { FileSystemHandler } from './file-system-handler'
import { TerminalHandler } from './terminal-handler'
import { PermissionBridge } from './permission-bridge'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Synthetic event emitted when a sessionUpdate carries `status === "completed"`.
 *
 * Consumed by `acp.ts` to know when to close the async generator.
 */
export interface DoneEvent {
  type: 'done'
}

/**
 * Union of all events emitted by AcpScanClient through `onEvent`.
 */
export type AcpClientEvent = SessionUpdateHandlerEvent | DoneEvent

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AcpScanClientOptions {
  /**
   * Optional callback invoked for each event produced during `sessionUpdate`.
   * Receives both handler-mapped events (tool_call, plan, cost, server_info)
   * and synthetic events (done).
   */
  onEvent?: (event: AcpClientEvent) => void

  /**
   * The scan ID used to scope permission requests.
   * Passed to PermissionBridge for same-origin checks.
   */
  scanId?: string
}

// ---------------------------------------------------------------------------
// AcpScanClient
// ---------------------------------------------------------------------------

/**
 * Implements the ACP `Client` interface, routing agent requests to typed handlers.
 *
 * @example
 * ```ts
 * const client = new AcpScanClient(
 *   new FileSystemHandler(),
 *   new TerminalHandler({ onOutput: emitTerminalOutput }),
 *   permissionBridge,
 *   new SessionUpdateHandler(),
 *   { onEvent: (event) => pushEvent(event) },
 * )
 *
 * const conn = new ClientSideConnection((agent) => {
 *   client.setAgent(agent)
 *   return client
 * }, stream)
 * ```
 */
export class AcpScanClient implements Client {
  private agent: Agent | null = null
  /** Wired by SessionManager after connect() returns the client reference. */
  onEvent?: (event: AcpClientEvent) => void
  private readonly scanId: string

  constructor(
    private readonly fsHandler: FileSystemHandler,
    private readonly terminalHandler: TerminalHandler,
    private readonly permissionBridge: PermissionBridge,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    options?: AcpScanClientOptions,
  ) {
    this.onEvent = options?.onEvent
    this.scanId = options?.scanId ?? 'unknown'
  }

  // -----------------------------------------------------------------------
  // setAgent
  // -----------------------------------------------------------------------

  /**
   * Stores a reference to the `Agent` interface provided by `ClientSideConnection`.
   *
   * Called by the `toClient` factory function when the connection is established.
   * The stored agent reference enables callbacks (e.g., requestPermission
   * could later trigger an agent notification).
   */
  setAgent(agent: Agent): void {
    this.agent = agent
  }

  // -----------------------------------------------------------------------
  // sessionUpdate — notification handler with event emission
  // -----------------------------------------------------------------------

  /**
   * Handles session update notifications from the agent.
   *
   * 1. Dispatches through `SessionUpdateHandler.dispatch()` to produce typed events.
   * 2. Checks for a synthetic `done` event when `status === "completed"`.
   * 3. Pushes all events through the optional `onEvent` callback.
   */
  async sessionUpdate(params: SessionNotification): Promise<void> {
    // Dispatch to the session-update handler to get typed events
    const handlerEvents = this.sessionUpdateHandler.dispatch(params)

    for (const event of handlerEvents) {
      this.onEvent?.(event)
    }

    // Check for session completion — emitted as a synthetic `done` event
    if (
      'status' in params.update &&
      params.update.status === 'completed'
    ) {
      this.onEvent?.({ type: 'done' })
    }
  }

  // -----------------------------------------------------------------------
  // requestPermission — delegates to PermissionBridge
  // -----------------------------------------------------------------------

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return this.permissionBridge.requestPermission(this.scanId, params)
  }

  // -----------------------------------------------------------------------
  // writeTextFile — delegates to FileSystemHandler
  // -----------------------------------------------------------------------

  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    return this.fsHandler.writeTextFile(params)
  }

  // -----------------------------------------------------------------------
  // readTextFile — delegates to FileSystemHandler
  // -----------------------------------------------------------------------

  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    return this.fsHandler.readTextFile(params)
  }

  // -----------------------------------------------------------------------
  // createTerminal — delegates to TerminalHandler
  // -----------------------------------------------------------------------

  async createTerminal(
    params: CreateTerminalRequest,
  ): Promise<CreateTerminalResponse> {
    return this.terminalHandler.createTerminal(params)
  }

  // -----------------------------------------------------------------------
  // terminalOutput — delegates to TerminalHandler
  // -----------------------------------------------------------------------

  async terminalOutput(
    params: TerminalOutputRequest,
  ): Promise<TerminalOutputResponse> {
    return this.terminalHandler.terminalOutput(params)
  }

  // -----------------------------------------------------------------------
  // waitForTerminalExit — delegates to TerminalHandler
  // -----------------------------------------------------------------------

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    return this.terminalHandler.waitForTerminalExit(params)
  }

  // -----------------------------------------------------------------------
  // killTerminal — delegates to TerminalHandler
  // -----------------------------------------------------------------------

  async killTerminal(
    params: KillTerminalRequest,
  ): Promise<KillTerminalResponse> {
    return this.terminalHandler.killTerminal(params)
  }

  // -----------------------------------------------------------------------
  // releaseTerminal — delegates to TerminalHandler
  // -----------------------------------------------------------------------

  async releaseTerminal(
    params: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse> {
    return this.terminalHandler.releaseTerminal(params)
  }
}
