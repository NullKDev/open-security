# Tasks: rich-acp-chat

> Strict TDD: every implementation task is preceded by a RED test task.
> Spec domains: acp-sdk-transport · agent-configs · rich-event-taxonomy · permission-bridge · ui-components

---

## Phase 1: Foundation — SDK + ACP Transport Modules

- [x] 1.1 **`package.json`** — add `@agentclientprotocol/sdk@0.21.0`; run `bun install` to update `bun.lock`
- [x] 1.2 **`tests/unit/providers/transport/spawn-shell.test.ts`** — RED: assert SIGTERM then SIGKILL after 5 s; login-shell invocation via `$SHELL -l -c`; fallback to `/bin/sh`
- [x] 1.3 **`lib/providers/transport/spawn-shell.ts`** — GREEN: `spawnLoginShell()` with SIGTERM→5s→SIGKILL teardown; Windows direct-spawn fallback
- [x] 1.4 **`tests/unit/providers/transport/connection-manager.test.ts`** — RED: PassThrough pair produces valid ndJsonStream; `ClientSideConnection` wraps stream correctly
- [x] 1.5 **`lib/providers/transport/connection-manager.ts`** — GREEN: `ndJsonStream` + `ClientSideConnection`; Node Readable → Web ReadableStream via `Readable.toWeb()`
- [x] 1.6 **`tests/unit/providers/transport/session-update-handler.test.ts`** — RED: table-driven `SessionNotification` → `ProviderEvent` mapping; unknown type → ignored
- [x] 1.7 **`lib/providers/transport/session-update-handler.ts`** — GREEN: `SessionUpdateHandler.dispatch()` routes all known notification types; no regex
- [x] 1.8 **`tests/unit/providers/transport/acp-client.test.ts`** — RED: mock `ClientSideConnection`; assert `AcpScanClient` emits `server_info` on connect and `done` on `status:"completed"`
- [x] 1.9 **`lib/providers/transport/acp-client.ts`** — GREEN: `AcpScanClient implements Client` from SDK; wires `SessionUpdateHandler`, `FileSystemHandler`, `TerminalHandler`, `PermissionBridge`
- [x] 1.10 **`lib/providers/transport/file-system-handler.ts`** — `readTextFile`/`writeTextFile` using `fs/promises`; no SDK imports
- [x] 1.11 **`tests/unit/providers/transport/terminal-handler.test.ts`** — RED: byte-limit truncation; exitPromise resolves; SSE output emitted
- [x] 1.12 **`lib/providers/transport/terminal-handler.ts`** — GREEN: `ManagedTerminal` with `outputByteLimit`, `exitPromise`, SSE output callback
- [x] 1.13 **`tests/unit/providers/transport/session-manager.test.ts`** — RED: happy-path FSM (spawn→init→newSession→prompt→completed); non-zero exit before `session/new` → `error`; AbortSignal → `cancel`; auth-retry on -32000; process leak prevention; sessionUpdate forwarding
- [x] 1.14 **`lib/providers/transport/session-manager.ts`** — GREEN: full ACP lifecycle FSM; auth-retry on -32000; `traffic-logger` calls non-blocking; async generator with promise-resolver event bridge; early-exit detection via Promise.race; process leak prevention in finally
- [x] 1.15 **`lib/providers/transport/traffic-logger.ts`** — `logTraffic()` writes to `.obt/acp-traffic.log`; uses `lib/config/workspace.ts` path helper; non-blocking
- [x] 1.16 **`lib/providers/transport/acp.ts`** — REWRITE: thin adapter calling `SessionManager`; zero regex; process leak prevention in `finally`

---

## Phase 2: Agent Configs

- [x] 2.1 **`tests/unit/providers/cli/agents.test.ts`** — RED: snapshot tests for gemini (`acpArgs:['--acp']`), opencode (`transport:'acp'`), qwen (`transport:'acp'`, `acpArgs:['--acp']`), codex (npx wrapper), copilot (new), auggie (new); assert `buildArgs` NOT exported for acp agents
- [x] 2.2 **`lib/providers/cli/agents.ts`** — GREEN: fix gemini/opencode/qwen/codex configs; add copilot (`npx @github/copilot-language-server@latest --acp`) and auggie (`npx @augmentcode/auggie@latest --acp`); guard `buildArgs` from ACP path

---

## Phase 3: Rich Event Taxonomy

- [x] 3.1 **`tests/unit/pipeline/events.test.ts`** — RED: Zod round-trip for all 9 new event types; unknown discriminant → `ZodError`; existing types unchanged
- [x] 3.2 **`lib/pipeline/events.ts`** — GREEN: add 9 Zod schemas (`tool_call`, `tool_result`, `permission_request`, `cost`, `server_info`, `file_read`, `file_write`, `terminal_output`, `plan`) to discriminated union; `isHighPriorityEvent` includes `permission_request`
- [x] 3.3 **`lib/providers/index.ts`** — extend `ProviderEvent` union with 9 new typed variants matching design §5; no breaking changes to existing types
- [x] 3.4 **`tests/unit/pipeline/stage2-llm.test.ts`** — RED: all 9 new event types forwarded as SSE `data:` lines; none dropped
- [x] 3.5 **`lib/pipeline/stage2-llm.ts`** — GREEN: `handleProviderEvent` passes through all 9 new types; default no-op removed for known types

---

## Phase 4: Permission Bridge + API Route

- [x] 4.1 **`tests/unit/providers/transport/permission-bridge.test.ts`** — RED: resolve happy path; scan-mode auto-approves synchronously (no SSE); interactive timeout → reject after 60 s; `rejectAllForScan()` clears registry; cross-scan requestId → rejected
- [x] 4.2 **`lib/providers/transport/permission-bridge.ts`** — GREEN: `PermissionBridge` class; `Map<scanId, Map<requestId, Pending>>`; 60 s `NodeJS.Timeout`; timer cleared on early resolve; `mode: 'auto' | 'interactive'`
- [x] 4.3 **`lib/providers/index.ts`** (ScanOpts) — add `permissionMode?: 'auto' | 'interactive'` (default `'auto'`)
- [x] 4.4 **`tests/unit/app/api/scans/permission.test.ts`** — RED: POST 200 `{ok:true}` on valid resolve; 404 unknown/expired; 400 malformed body; cross-scan returns 404
- [x] 4.5 **`app/api/scans/[id]/permission/route.ts`** — GREEN: `POST` handler; Zod body validation `{ requestId, approved }`; delegates to `PermissionBridge`; same-origin check; returns correct status codes

---

## Phase 5: UI Components + ScanProgress Enrichment

- [x] 5.1 **`tests/unit/components/ui/ToolCallBlock.test.tsx`** — RED: renders `toolName`; collapsible; error state visually distinct when `isError=true`
- [x] 5.2 **`components/ui/ToolCallBlock.tsx`** — GREEN: props `{ toolName, toolCallId, input, result?, isError? }`; collapsible; error style
- [x] 5.3 **`tests/unit/components/ui/CostBadge.test.tsx`** — RED: formats `costUsd` to 4 decimal places; renders token counts
- [x] 5.4 **`components/ui/CostBadge.tsx`** — GREEN: props `{ inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, costUsd? }`
- [x] 5.5 **`tests/unit/components/ui/PlanBlock.test.tsx`** — RED: distinct visual per status; `in_progress` highlighted; empty steps array rejected
- [x] 5.6 **`components/ui/PlanBlock.tsx`** — GREEN: props `{ steps: Array<{title, status}> }`; status variants `pending|in_progress|done|error`
- [x] 5.7 **`tests/unit/components/ui/TerminalOutputBlock.test.tsx`** — RED: non-zero `exitCode` → error style; optional `command` rendered; plain output rendered
- [x] 5.8 **`components/ui/TerminalOutputBlock.tsx`** — GREEN: props `{ command?, output, exitCode? }`
- [x] 5.9 **`tests/unit/components/ui/PermissionDialog.test.tsx`** — RED: countdown visible; Approve → POST `approved:true`; Deny → POST `approved:false`; auto-dismiss on timeout (no POST); no `.obt` literals
- [x] 5.10 **`components/ui/PermissionDialog.tsx`** — GREEN: props `{ requestId, toolName, input, timeoutMs, scanId, onSettled }`; countdown timer; calls POST `/api/scans/${scanId}/permission`
- [x] 5.11 **`tests/unit/app/scans/ScanProgress.test.tsx`** — RED: `tool_call`→ToolCallBlock; `tool_result`→appended to matching block; `permission_request`→PermissionDialog (interactive) or no-op (scan); `cost`→CostBadge; `plan`→PlanBlock; `terminal_output`→TerminalOutputBlock; `file_read`/`file_write`→inline annotation
- [x] 5.12 **`app/scans/[id]/ScanProgress.tsx`** — GREEN: `useReducer` keyed by `toolCallId` for tool events; mount `PermissionDialog` at root; render all 9 new event types; no `.obt` string literals

---

## Parallel / Sequential Notes

- Phases 1–3 are sequential (SDK must land before transport modules; transport modules before events).
- Phase 4 can begin as soon as `PermissionBridge` class is stubbed (task 1.x), independent of UI.
- Phase 5 tasks within a component pair (RED+GREEN) are sequential; pairs are parallel with each other.
- Tasks 1.2–1.15 within Phase 1 can proceed in parallel as long as each module's RED test is written first.
