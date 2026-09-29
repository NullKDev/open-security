# Permission Bridge Specification

## Purpose

Defines the pending-promise registry, the `POST /api/scans/[id]/permission` endpoint, timeout and cleanup semantics, and the behavioral difference between scan mode (auto-approve) and interactive mode (human decision required).

## Requirements

### Requirement: Pending-Promise Registry

The permission bridge (`lib/providers/transport/permission-bridge.ts`) MUST maintain an in-memory registry mapping `requestId` → `{ resolve, reject, timer }`. The registry MUST be scoped per scan session and MUST be fully cleared on scan completion, cancellation, or error.

#### Scenario: Permission registered

- GIVEN a `permission_request` event with `requestId: 'pr-abc'`
- WHEN `bridge.register('pr-abc', 60000)` is called
- THEN a `Promise<boolean>` MUST be returned
- AND the registry MUST contain an entry keyed `'pr-abc'`

#### Scenario: Registry cleared on scan complete

- GIVEN 2 pending entries exist in the registry for scan `s-1`
- WHEN `bridge.clear('s-1')` is called (scan completed)
- THEN both promises MUST be rejected with reason `'scan_ended'`
- AND the registry MUST contain zero entries for scan `s-1`

---

### Requirement: 60-Second Timeout

Every registered permission request MUST auto-reject after 60 seconds if no resolution arrives. On timeout, the pending promise MUST reject with `{ reason: 'timeout', requestId }` and the registry entry MUST be removed.

#### Scenario: Auto-reject on timeout

- GIVEN a permission request registered with `timeoutMs: 60000`
- WHEN 60 000 ms elapse without a `POST /api/scans/[id]/permission` call
- THEN the promise MUST reject
- AND the registry entry MUST be removed

#### Scenario: Timer cancelled on early resolution

- GIVEN a permission request is pending
- WHEN `bridge.resolve('pr-abc', true)` is called before timeout
- THEN the internal timer MUST be cleared
- AND the promise MUST resolve to `true`

---

### Requirement: POST /api/scans/[id]/permission Endpoint

The endpoint MUST accept `POST /api/scans/[id]/permission` with a Zod-validated JSON body: `{ requestId: string, approved: boolean }`. On success it MUST return `200 { ok: true }`. It MUST return `404` for unknown or expired `requestId`. It MUST return `400` for malformed body.

#### Scenario: Approval resolves pending promise

- GIVEN request `pr-abc` is pending for scan `s-1`
- WHEN `POST /api/scans/s-1/permission` with `{ requestId: 'pr-abc', approved: true }` is called
- THEN the pending promise MUST resolve to `true`
- AND the response MUST be `200 { ok: true }`

#### Scenario: Denial resolves pending promise to false

- GIVEN request `pr-abc` is pending
- WHEN `POST` is called with `approved: false`
- THEN the pending promise MUST resolve to `false`

#### Scenario: Unknown requestId returns 404

- GIVEN no entry for `requestId: 'nonexistent'` exists
- WHEN `POST /api/scans/s-1/permission` with that `requestId` is sent
- THEN the response MUST be `404`

#### Scenario: Malformed body returns 400

- GIVEN a POST body with `approved: "yes"` (string instead of boolean)
- WHEN the endpoint receives it
- THEN Zod validation MUST fail and the response MUST be `400` with a Zod error description

#### Scenario: Expired requestId returns 404

- GIVEN a permission request timed out 5 seconds ago
- WHEN `POST /api/scans/[id]/permission` is called with that `requestId`
- THEN the response MUST be `404`

---

### Requirement: Scan Mode Auto-Approve

When the scan is initiated in non-interactive (scan) mode, the ACP client MUST automatically approve all `requestPermission` calls from the SDK without creating a pending promise or calling the POST endpoint. Approval MUST happen synchronously within the same tick.

#### Scenario: Auto-approval in scan mode

- GIVEN `opts.mode === 'scan'` (or the equivalent non-interactive flag)
- WHEN the SDK calls `requestPermission({ toolName: 'bash', input: {} })`
- THEN the handler MUST return `{ approved: true }` immediately
- AND NO `permission_request` ProviderEvent MUST be emitted

---

### Requirement: Interactive Mode Permission Flow

When in interactive mode, every `requestPermission` SDK call MUST: (1) emit a `permission_request` ProviderEvent on the SSE stream, (2) register a pending promise, (3) await resolution via the POST endpoint or timeout, (4) return the resolved value to the SDK.

#### Scenario: Interactive permission flow end-to-end

- GIVEN `opts.mode === 'interactive'`
- WHEN the SDK calls `requestPermission({ toolName: 'write_file', input: { path: '/etc/hosts' } })`
- THEN a `permission_request` event MUST be emitted on the SSE stream
- AND the handler MUST block until the POST endpoint resolves it
- AND the approved/denied result MUST be returned to the SDK as `{ approved: boolean }`

#### Scenario: Timeout cancels ACP session

- GIVEN a permission request is pending in interactive mode
- WHEN the 60-second timeout fires
- THEN the ACP session MUST be cancelled (via `connection.cancel()`)
- AND an `error` ProviderEvent MUST be emitted with message `'Permission request timed out'`

---

### Requirement: Same-Origin and Replay Protection

The POST endpoint MUST validate that the `requestId` belongs to the scan identified by the URL `[id]` parameter. Cross-scan or replayed `requestId` values MUST be rejected with `403`.

#### Scenario: Cross-scan requestId rejected

- GIVEN `requestId: 'pr-abc'` belongs to scan `s-1`
- WHEN `POST /api/scans/s-2/permission` is called with that `requestId`
- THEN the response MUST be `403`
