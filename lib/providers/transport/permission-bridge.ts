/**
 * PermissionBridge — pending-promise registry for ACP permission requests.
 *
 * Converts the ACP SDK's blocking `requestPermission` call into a pending
 * promise that can be resolved or rejected externally (via the POST
 * `/api/scans/[id]/permission` route).
 *
 * Modes:
 * - `auto` — resolves immediately with the first allow option (no SSE, no wait)
 * - `interactive` — emits permission_request SSE event, creates pending promise
 *   with 60s timeout, awaits POST from the UI
 *
 * Lifecycle:
 * 1. Agent calls requestPermission → bridge creates UUID + Pending, starts 60s timer
 * 2. UI renders PermissionDialog → user clicks Approve/Deny
 * 3. POST /api/scans/{id}/permission → bridge.resolveRequest()
 * 4. SDK promise resolves → agent continues
 *
 * On scan cancel/error: rejectAllForScan() BEFORE SIGTERM
 *
 * Shared between AcpScanClient and POST route via module-level singleton
 * (getPermissionBridge).
 *
 * @module permission-bridge
 */
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  PermissionOption,
} from '@agentclientprotocol/sdk'
import * as PendingTurnQueue from './pending-turn-queue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A pending permission request waiting for user approval.
 */
interface Pending {
  /** Resolves the SDK's requestPermission promise with the user's choice */
  resolve: (value: RequestPermissionResponse) => void
  /** Rejects the SDK's requestPermission promise (timeout, cancel, error) */
  reject: (err: Error) => void
  /** 60-second auto-reject timer */
  timer: NodeJS.Timeout
  /** The scan this request belongs to (for same-origin checks) */
  scanId: string
  /** The original permission options from the agent (needed to select optionId) */
  options: PermissionOption[]
}

// ---------------------------------------------------------------------------
// PermissionBridge
// ---------------------------------------------------------------------------

/**
 * Pending-promise registry for ACP permission requests.
 *
 * Uses a two-level Map: `Map<scanId, Map<requestId, Pending>>` so
 * requests are scoped per scan. This prevents cross-scan request
 * replay and enables bulk rejection on scan cancel.
 */
export class PermissionBridge {
  /** Map<scanId, Map<requestId, Pending>> */
  private pending = new Map<string, Map<string, Pending>>()

  constructor(private mode: 'auto' | 'interactive' = 'auto') {}

  // -----------------------------------------------------------------------
  // requestPermission — called by AcpScanClient when agent requests permission
  // -----------------------------------------------------------------------

  /**
   * Handles a permission request from the ACP agent.
   *
   * In `auto` mode, resolves immediately with the first allow option.
   * In `interactive` mode, creates a pending promise with a 60s timeout
   * and returns it — the caller should emit a `permission_request` SSE event
   * and store the requestId for the POST endpoint.
   *
   * @param scanId - The scan this request belongs to
   * @param params - The ACP permission request with options
   * @returns The permission response (sync in auto mode, async in interactive)
   */
  async requestPermission(
    scanId: string,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    if (this.mode === 'auto') {
      // Auto-approve: find the first allow option and resolve immediately
      const allowOption = params.options.find(
        (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
      )
      const optionId =
        allowOption?.optionId ?? params.options[0]?.optionId ?? ''
      return {
        outcome: {
          outcome: 'selected',
          optionId,
        },
      } as RequestPermissionResponse
    }

    // Interactive mode: create a pending promise with 60s timeout
    const requestId = crypto.randomUUID()

    return new Promise<RequestPermissionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectRequest(scanId, requestId, new Error('Permission timeout'))
      }, 60_000)

      const pending: Pending = {
        resolve,
        reject,
        timer,
        scanId,
        options: params.options,
      }

      if (!this.pending.has(scanId)) {
        this.pending.set(scanId, new Map())
      }
      this.pending.get(scanId)!.set(requestId, pending)

      // The caller (AcpScanClient / SessionManager) should:
      // 1. Emit a permission_request SSE event with the requestId
      // 2. Store the requestId for the POST endpoint
      // The requestId is NOT returned from this method (return type is
      // RequestPermissionResponse), so the caller must capture it
      // through a separate mechanism (e.g., event emission).
    })
  }

  // -----------------------------------------------------------------------
  // resolveRequest — called by POST /api/scans/[id]/permission
  // -----------------------------------------------------------------------

  /**
   * Resolves a pending permission request with the user's decision.
   *
   * When `approved` is `false` and a `redirectInstruction` is supplied,
   * the instruction is enqueued as a `'redirect'` turn in the scan's
   * {@link PendingTurnQueue} so the agent can try an alternative approach.
   *
   * @param scanId - The scan the request belongs to
   * @param requestId - The unique request ID (generated by requestPermission)
   * @param approved - Whether the user approved the request
   * @param redirectInstruction - Optional: if denying, inject this as a redirect turn
   * @returns `true` if the request was found and resolved, `false` otherwise
   */
  resolveRequest(
    scanId: string,
    requestId: string,
    approved: boolean,
    redirectInstruction?: string,
  ): boolean {
    const scan = this.pending.get(scanId)
    if (!scan) return false

    const pending = scan.get(requestId)
    if (!pending) return false

    // Clear the timeout — the user has responded
    clearTimeout(pending.timer)
    scan.delete(requestId)

    if (approved) {
      // Find the first allow option to use as the selected optionId
      const allowOption = pending.options.find(
        (o) => o.kind === 'allow_once' || o.kind === 'allow_always',
      )
      const optionId =
        allowOption?.optionId ?? pending.options[0]?.optionId ?? ''
      pending.resolve({
        outcome: {
          outcome: 'selected',
          optionId,
        },
      } as RequestPermissionResponse)
    } else {
      // User denied — return cancelled outcome
      pending.resolve({
        outcome: {
          outcome: 'cancelled',
        },
      } as RequestPermissionResponse)

      // v0.3: if a redirect instruction was provided, enqueue it as a turn
      if (redirectInstruction !== undefined && redirectInstruction.length > 0) {
        PendingTurnQueue.forScan(scanId).enqueue({
          kind: 'redirect',
          content: redirectInstruction,
        })
      }
    }

    return true
  }

  // -----------------------------------------------------------------------
  // rejectRequest — called internally (timeout) or by SessionManager (cancel)
  // -----------------------------------------------------------------------

  /**
   * Rejects a pending permission request with an error.
   *
   * @param scanId - The scan the request belongs to
   * @param requestId - The unique request ID to reject
   * @param error - The error to reject the promise with
   */
  rejectRequest(scanId: string, requestId: string, error: Error): void {
    const scan = this.pending.get(scanId)
    if (!scan) return

    const pending = scan.get(requestId)
    if (!pending) return

    clearTimeout(pending.timer)
    scan.delete(requestId)
    pending.reject(error)
  }

  // -----------------------------------------------------------------------
  // rejectAllForScan — called on scan cancel/error BEFORE SIGTERM
  // -----------------------------------------------------------------------

  /**
   * Rejects all pending permission requests for a given scan.
   *
   * Should be called BEFORE sending SIGTERM to the agent process
   * so all pending promises are cleaned up before teardown.
   *
   * @param scanId - The scan whose pending requests should be rejected
   */
  rejectAllForScan(scanId: string): void {
    const scan = this.pending.get(scanId)
    if (!scan) return

    for (const [, pending] of scan) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Scan cancelled'))
    }
    this.pending.delete(scanId)
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton for sharing between AcpScanClient and POST route
// ---------------------------------------------------------------------------

let instance: PermissionBridge | null = null

/**
 * Returns the module-level singleton PermissionBridge instance.
 *
 * The first call creates the instance with the given mode. Subsequent
 * calls return the same instance regardless of the mode argument.
 *
 * @param mode - Permission mode for the initial creation ('auto' or 'interactive')
 * @returns The singleton PermissionBridge instance
 */
export function getPermissionBridge(
  mode?: 'auto' | 'interactive',
): PermissionBridge {
  if (!instance) {
    instance = new PermissionBridge(mode)
  }
  return instance
}
