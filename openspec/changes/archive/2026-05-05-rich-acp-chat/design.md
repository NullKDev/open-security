# Design: Rich ACP Chat Integration

## Technical Approach

Replace the broken hand-rolled JSON-RPC ACP transport with `@agentclientprotocol/sdk@0.21.0`. Port 8 modules from the `vscode-acp` reference, stripped of VS Code dependencies and rewired to the existing scan pipeline. Introduce a pending-promise permission bridge that turns the SDK's blocking `requestPermission` into an SSE round-trip. Extend `ProviderEvent`/`ScanEvent` with a typed taxonomy (`tool_call`, `permission_request`, `cost`, `file_read/write`, `terminal_output`, `plan`, `server_info`). UI grows three components rendered by `ScanProgress.tsx`.

## 1. File Structure

### New files

| Path | Purpose |
|------|---------|
| `lib/providers/transport/spawn-shell.ts` | Login-shell spawn helper (`zsh -l -c`) with SIGTERM+SIGKILL teardown, stderr forwarder |
| `lib/providers/transport/connection-manager.ts` | Wraps Readable/Writable as Web streams, builds `ndJsonStream` + `ClientSideConnection` |
| `lib/providers/transport/session-manager.ts` | Lifecycle: spawn → connect → initialize → newSession → sendPrompt → cancel; auth-retry on `-32000` |
| `lib/providers/transport/acp-client.ts` | `AcpScanClient implements Client` from SDK; routes notifications to handlers |
| `lib/providers/transport/session-update-handler.ts` | Maps SDK `SessionNotification` → `ProviderEvent` stream |
| `lib/providers/transport/file-system-handler.ts` | `readTextFile` (line/limit) and `writeTextFile` via `fs/promises`, emits `file_read`/`file_write` |
| `lib/providers/transport/terminal-handler.ts` | `ManagedTerminal` with `outputByteLimit`, `exitPromise`, emits `terminal_output` |
| `lib/providers/transport/permission-bridge.ts` | Pending-promise registry keyed by UUID; resolve/reject/timeout |
| `app/api/scans/[id]/permission/route.ts` | `POST` endpoint: Zod-validated `{ requestId, optionId }`, resolves bridge |
| `components/ui/ToolCallBlock.tsx` | Renders `tool_call` with status badge + collapsible detail |
| `components/ui/PermissionDialog.tsx` | Modal triggered by `permission_request`; POSTs choice |
| `components/ui/CostBadge.tsx` | Small inline badge for cumulative cost |
| `tests/unit/providers/transport/*.test.ts` | One per new module |

### Modified files

| Path | Change |
|------|--------|
| `lib/providers/transport/acp.ts` | Rewritten; thin adapter that constructs `SessionManager` and forwards events |
| `lib/providers/cli/agents.ts` | Fix `acpArgs`/`transport` for gemini/opencode/qwen/codex; add `copilot`, `auggie` |
| `lib/providers/index.ts` | Extend `ProviderEvent` union with new variants |
| `lib/pipeline/events.ts` | Add Zod schemas for new events; extend discriminated union |
| `lib/pipeline/stage2-llm.ts` | `handleProviderEvent` switch: pass-through new event types |
| `app/scans/[id]/ScanProgress.tsx` | Render new event types |
| `package.json` / `bun.lock` | Pin `@agentclientprotocol/sdk@0.21.0` |

### Deleted

None — `acp.ts` is rewritten in place. `spawn.ts` stays (used by `spawn-json` and `http` transports).

## 2. Module Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │ acpScan() (acp.ts — thin adapter)           │
                 └──┬──────────────────────────────────────────┘
                    │ creates
                    ▼
         ┌─────────────────────────┐         ┌──────────────────────┐
         │ SessionManager          │ ──uses──│ spawn-shell.ts       │
         │  • lifecycle FSM        │         │  (login-shell child) │
         │  • auth-retry           │         └──────────────────────┘
         │  • cancel/cleanup       │
         └────┬────────────────────┘
              │ owns
              ▼
         ┌─────────────────────────┐
         │ ConnectionManager       │ ──builds──> ndJsonStream + ClientSideConnection
         └────┬────────────────────┘             (from @agentclientprotocol/sdk)
              │ injects
              ▼
         ┌─────────────────────────┐    delegates    ┌────────────────────────────┐
         │ AcpScanClient (Client)  │────────────────>│ SessionUpdateHandler       │
         │  • sessionUpdate        │                 │ FileSystemHandler          │
         │  • requestPermission    │                 │ TerminalHandler            │
         │  • readTextFile/write   │                 │ PermissionBridge (registry)│
         │  • createTerminal       │                 └────────────────────────────┘
         └─────────────────────────┘
                    │
                    ▼ emits ProviderEvent stream consumed by stage2-llm.ts
```

Dependency direction is one-way: handlers do not import each other. Bridge is shared between `AcpScanClient` and the `POST /permission` route via a module-level `Map<scanId, Map<requestId, Pending>>`.

## 3. Data Flow (notification → UI)

```
agent stdout (ndjson)
   ↓  Readable.toWeb() → ndJsonStream
ClientSideConnection.sessionUpdate(notification)
   ↓
AcpScanClient.sessionUpdate(params)
   ↓
SessionUpdateHandler.dispatch(params)
   ↓  switch on params.update.sessionUpdate
ProviderEvent yielded into async iterator (acpScan generator)
   ↓
stage2-llm.handleProviderEvent → onEvent(ScanEvent)
   ↓
ScanBus.publish(scanId, event) → SQLite + in-memory buffer
   ↓
SSE route /api/scans/[id]/stream → text/event-stream
   ↓
ScanProgress.tsx EventSource → React state → ToolCallBlock / PermissionDialog / CostBadge
```

## 4. Permission Bridge

### Sequence

```
Agent                AcpScanClient            Bridge              SSE          UI
  │ requestPermission(req)│                      │                  │           │
  │──────────────────────>│ create UUID, Pending │                  │           │
  │                       │─────────────────────>│                  │           │
  │                       │ start 60s timer      │                  │           │
  │                       │ emit permission_request                 │           │
  │                       │─────────────────────────────────────────>           │
  │                       │                      │                  │──render──>│
  │                       │                                                     │
  │                       │            POST /permission { requestId, optionId } │
  │                       │<────────────────────────────────────────────────────│
  │                       │ bridge.resolve(requestId, optionId)                 │
  │                       │<─────────────────────│                              │
  │ {outcome:'selected'}  │                      │                              │
  │<──────────────────────│ clear timer          │                              │
```

### Pending entry

```ts
interface Pending {
  resolve: (outcome: PermissionOutcome) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
  scanId: string
  toolCallId: string
  options: PermissionOption[]
}
```

### Lifecycle rules

- **Timeout (60s)**: in scan mode auto-resolve with first `kind === 'allow'` option; in interactive mode reject with timeout error → SDK propagates back as `cancelled`.
- **Scan cancel**: `SessionManager.cancel()` calls `bridge.rejectAllForScan(scanId, 'scan cancelled')` BEFORE SIGTERM, then connection.cancel(), then 5s SIGKILL grace.
- **Unknown requestId on POST**: 404 (already resolved/expired/wrong scan).
- **Cross-scan replay**: `requestId` is scoped by `scanId` — POST must include both.
- **Same-origin**: Next.js route checks `Origin` header against deployment host.

## 5. New Event Types

### ProviderEvent additions (`lib/providers/index.ts`)

```ts
export interface ToolCallEvent {
  type: 'tool_call'
  toolCallId: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  kind?: 'read' | 'edit' | 'execute' | 'search' | 'fetch' | 'other'
  detail?: string
}

export interface ToolResultEvent {
  type: 'tool_result'
  toolCallId: string
  status: 'completed' | 'failed'
  output?: string
}

export interface PermissionRequestEvent {
  type: 'permission_request'
  requestId: string
  toolCallId: string
  toolTitle: string
  options: Array<{ id: string; name: string; kind: 'allow' | 'reject' | 'allow_once' | 'reject_once' }>
}

export interface CostEvent {
  type: 'cost'
  inputTokens?: number
  outputTokens?: number
  totalUsd?: number
}

export interface ServerInfoEvent {
  type: 'server_info'
  agentName: string
  agentVersion?: string
  protocolVersion: string
  capabilities: Record<string, unknown>
}

export interface FileReadEvent  { type: 'file_read';  path: string; bytes: number }
export interface FileWriteEvent { type: 'file_write'; path: string; bytes: number }

export interface TerminalOutputEvent {
  type: 'terminal_output'
  terminalId: string
  stream: 'stdout' | 'stderr'
  data: string
  truncated?: boolean
}

export interface PlanEvent {
  type: 'plan'
  entries: Array<{ status: 'pending' | 'in_progress' | 'completed'; title: string; description?: string }>
}
```

### ScanEvent (Zod)

Mirror each ProviderEvent into a Zod schema in `lib/pipeline/events.ts` and append to `scanEventSchema` discriminated union. `isHighPriorityEvent` must include `permission_request` (must never be dropped).

## 6. Agent Spawning (login shell)

`spawn-shell.ts` exports:

```ts
export function spawnLoginShell(
  bin: string,
  args: string[],
  opts: { cwd: string; env?: Record<string,string|undefined>; onStderrLine?: (l:string)=>void }
): SpawnResult
```

On macOS/Linux: spawns `process.env.SHELL ?? '/bin/zsh'` with `['-l','-c', shellEscape([bin, ...args])]`. On Windows: falls back to direct `spawn`. Returns the same `SpawnResult` shape as existing `spawn.ts` so `ConnectionManager` is platform-agnostic. Teardown:

1. `kill('SIGTERM')`
2. 5000ms timer → `kill('SIGKILL')`
3. Resolve `exited` either way

`AgentDef` is unchanged structurally; only `acpArgs`/`transport` values are corrected. The transport switch in the (existing) router calls `acpScan(def, prompt, opts)` which now uses `spawnLoginShell` instead of `spawnProvider`.

## 7. Scan Mode vs Interactive Mode

| Aspect | Scan Mode (default for pipeline) | Interactive Mode (future chat UI) |
|--------|----------------------------------|-----------------------------------|
| Permission default | Auto-resolve first `allow` option immediately | Emit `permission_request`, wait |
| 60s timeout | Auto-resolve allow | Reject with timeout error |
| SSE event | Suppressed | Emitted |
| Mode flag | `opts.permissionMode === 'auto'` | `opts.permissionMode === 'interactive'` |

`ScanOpts` gains `permissionMode?: 'auto' | 'interactive'` (default `'auto'`). `PermissionBridge` constructor takes the mode; behavior diverges only in `requestPermission`.

## 8. UI Component Tree (in `ScanProgress.tsx`)

```
<ScanProgress>
  <Header providerId metaBadges costBadge={CostBadge} />
  <EventList>
    {events.map(e => switch(e.type) {
      'tool_call'         => <ToolCallBlock {...e} />
      'tool_result'       => <ToolCallBlock.Result {...e} />
      'permission_request'=> null  /* handled by dialog */
      'plan'              => <PlanList entries={e.entries} />
      'terminal_output'   => <TerminalLine ... />
      'file_read'/'file_write' => <FileOp ... />
      'thinking'          => <ThinkingBlock ... />
      'response'          => <ResponseBlock ... />
      'finding'           => <FindingCard ... />
      ...existing
    })}
  </EventList>
  <PermissionDialog open={pendingPermission != null} request={pendingPermission} onChoose={postPermission} />
</ScanProgress>
```

Props (key components):

```ts
interface ToolCallBlockProps {
  toolCallId: string
  title: string
  status: 'pending'|'running'|'completed'|'failed'
  kind?: ToolCallKind
  detail?: string
  result?: { status: 'completed'|'failed'; output?: string }
}

interface PermissionDialogProps {
  open: boolean
  request: PermissionRequestEvent | null
  onChoose: (optionId: string) => Promise<void>
}

interface CostBadgeProps {
  inputTokens?: number
  outputTokens?: number
  totalUsd?: number
}
```

State: `useReducer` keyed by `toolCallId` to merge `tool_call` + `tool_call_update` + `tool_result` into a single row.

## 9. Test Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `spawn-shell` teardown | Stub `child_process.spawn` returning fake EE; assert SIGTERM then SIGKILL after 5s |
| Unit | `ConnectionManager` stream wiring | Pass `PassThrough` pair; assert `ndJsonStream` receives lines |
| Unit | `SessionUpdateHandler` mapping | Table-driven: every `SessionNotification` shape → expected `ProviderEvent` |
| Unit | `PermissionBridge` | Resolve before timeout, reject on timeout (interactive), auto-allow on timeout (scan), reject on cancel |
| Unit | `AcpScanClient` | Mock SDK `ClientSideConnection`; verify `sessionUpdate` is dispatched |
| Unit | Agent config corrections | Snapshot `AGENT_DEFS` fields for gemini/opencode/qwen/codex/copilot/auggie |
| Unit | `events.ts` Zod schemas | Round-trip parse for every new event variant |
| Integration | `acpScan` happy path | Fake stdout that emits ndjson sessionUpdate frames; consume async iterator; assert ProviderEvents |
| Integration | Permission round-trip | Spin up SessionManager + bridge + simulated POST; assert resolve under 500ms |
| Integration | Scan cancel | Start scan, fire cancel; assert pending promise rejects + child killed |
| E2E | (deferred) | Real gemini/opencode against tiny test repo, gated by env flag |

Mock strategy: do NOT mock `@agentclientprotocol/sdk` internals — wrap the SDK behind `ConnectionManager` so tests inject a fake `ClientSideConnection`-shaped object.

## 10. Migration Path

1. Land SDK + new modules behind transport switch — `acp.ts` rewritten, but only ACP agents touch it. `spawn-json`, `sdk` (claude), `http` (ollama) untouched.
2. Add new ProviderEvent variants as a NON-BREAKING extension of the union; existing consumers (`stage2-llm`) handle new variants in `default:` no-op until UI catches up.
3. Add Zod schemas + ScanEvent variants in same PR; `isHighPriorityEvent` updated.
4. Add POST `/permission` route; wire bridge.
5. Ship UI components last — they consume events that already flow.
6. Fix `AGENT_DEFS` last so corrected agents start using the new path only after the path is proven.

Rollback: revert merge, drop SDK dep, restore previous `acp.ts`. Non-ACP transports remain functional throughout.

## Open Questions

- [ ] Codex `--acp` native support: detect at probe time vs hard-code `npx @zed-industries/codex-acp@latest` wrapper?
- [ ] Should `cost` events update DB or be display-only? (proposal silent)
- [ ] `terminal_output` truncation byte budget — propose 1 MiB per terminal, configurable via `ScanOpts`.
