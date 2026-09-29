# Proposal: Rich ACP Chat Integration

## Intent

The current `lib/providers/transport/acp.ts` is a hand-rolled JSON-RPC client that uses a non-existent ACP method (`run`), regex-parses ndjson, and surfaces only ~10% of the protocol. Multiple agents (`gemini`, `opencode`, `qwen`, `codex`) have wrong `acpArgs` / `transport` values and never actually negotiate ACP. This blocks rich UX (tool calls, plans, permissions, cost) and leaves the workbench silently degraded for every CLI provider. We migrate to the official `@agentclientprotocol/sdk` and add a bidirectional permission bridge so scans can ask the user for approval inline.

## Scope

### In Scope
- Install `@agentclientprotocol/sdk@0.21.0` (pinned).
- Rewrite `lib/providers/transport/acp.ts` using `ClientSideConnection` + `ndJsonStream` lifecycle.
- New `AcpScanClient implements Client` with `sessionUpdate`, `requestPermission`, `readTextFile`, `writeTextFile`, terminal handlers.
- Login-shell spawning helper for macOS PATH resolution.
- Fix agent configs in `lib/providers/cli/agents.ts`: `gemini`, `opencode`, `qwen`, `codex`.
- Extend `ProviderEvent` and `ScanEvent` (Zod) with `tool_call`, `tool_result`, `permission_request`, `cost`, `server_info`, `file_read`, `file_write`, `terminal_output`, `plan`.
- Pending-promise permission bridge + new `POST /api/scans/[id]/permission` route.
- UI: `ToolCallBlock`, `PermissionDialog`, `CostBadge`; extend `ScanProgress.tsx` to render new events.
- Vitest coverage (TDD) for transport, client, bridge, and route.

### Out of Scope
- New agents beyond fixing existing four (copilot/auggie/qoder/openclaw/kiro/hermes deferred).
- Conversational chat input (multi-turn user prompts mid-scan) — bridge enables it but UX deferred.
- MCP server orchestration from open-security (we still pass `mcpServers: []`).
- Slash commands, mode/model pickers, registry-driven agent discovery.
- Migrating non-ACP transports (`spawn-json`, `spawn-text`) beyond config corrections.

## Capabilities

### New Capabilities
- `acp-transport`: ACP client lifecycle, session management, login-shell spawn, cancellation.
- `permission-bridge`: pending-promise registry bridging unidirectional SSE with blocking `requestPermission`.
- `rich-scan-events`: typed event taxonomy (tool_call, plan, permission_request, cost, file_*, terminal_output) end-to-end.

### Modified Capabilities
- `cli-providers`: corrected `acpArgs` / `transport` for gemini/opencode/qwen/codex.
- `scan-streaming`: SSE route forwards new event types; new permission POST endpoint.

## Approach

Phased rollout (each phase independently shippable):

1. **SDK + lifecycle**: install SDK, rewrite `acp.ts` with `session/new` + `session/prompt`, auto-approve permissions. Eliminates regex and the bogus `run` method.
2. **Agent configs**: fix `acpArgs`, `transport` values; wrap codex via `npx @zed-industries/codex-acp@latest` if native flag absent.
3. **Rich events**: add `tool_call`, `cost`, `server_info`, `file_read/write`, `plan` to ProviderEvent + Zod schemas; pipeline forwards them.
4. **Permission bridge**: pending-promise registry keyed by `requestId`, 60s timeout with auto-cancel; new `/api/scans/[id]/permission` POST route (Zod-validated).
5. **UI**: `ToolCallBlock`, `PermissionDialog`, `CostBadge`; `ScanProgress.tsx` routes new events.

Phases 1–3 deliver immediate value (correct protocol, rich data) without touching the bidirectional flow. Phase 4 is the architecturally novel piece and ships behind a feature-isolated module.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json` | Modified | Add `@agentclientprotocol/sdk@0.21.0` |
| `lib/providers/transport/acp.ts` | Rewritten | SDK lifecycle replaces manual JSON-RPC |
| `lib/providers/transport/acp-client.ts` | New | `AcpScanClient implements Client` |
| `lib/providers/transport/permission-bridge.ts` | New | Pending-promise registry |
| `lib/providers/transport/spawn-shell.ts` | New | Login-shell spawn helper |
| `lib/providers/cli/agents.ts` | Modified | Correct acpArgs/transport for 4 agents |
| `lib/providers/index.ts` | Modified | New event union members |
| `lib/pipeline/events.ts` | Modified | Zod schemas for new events |
| `lib/pipeline/stage2-llm.ts` | Modified | Forward new events |
| `app/api/scans/[id]/stream/route.ts` | Modified | Serialize new events |
| `app/api/scans/[id]/permission/route.ts` | New | POST endpoint |
| `app/scans/[id]/ScanProgress.tsx` | Modified | Render new events |
| `components/ui/ToolCallBlock.tsx` | New | Collapsible tool call |
| `components/ui/PermissionDialog.tsx` | New | Inline permission UI |
| `components/ui/CostBadge.tsx` | New | Token/cost display |
| `tests/unit/providers/*` | New/Rewritten | Vitest coverage |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `requestPermission` hangs if user idle | High | 60s timeout → auto-cancel + reject promise |
| Pre-1.0 SDK API churn | Medium | Pin `@agentclientprotocol/sdk@0.21.0`, lock in `bun.lock` |
| macOS PATH fails for ACP binaries | High | `spawn-shell.ts` uses `$SHELL -l -c` with explicit env merge |
| Codex lacks native `--acp` | Medium | Detect, fallback to `npx @zed-industries/codex-acp@latest` |
| Process leak on scan cancel | High | `connection.cancel()` then SIGTERM/SIGKILL (5s) + reject pending permission promises |
| SSE route grows beyond Next.js limits | Low | Keep events small, batch tool_call_update via debounce |
| Permission POST CSRF/replay | Medium | Tie `requestId` to scan session; reject unknown/expired IDs; same-origin check |

## Rollback Plan

Feature-isolated. To revert:
1. `git revert` the merge commit (or feature branch).
2. Uninstall SDK: `bun remove @agentclientprotocol/sdk`.
3. The previous `acp.ts` returns; agents continue running via `spawn-json` / `spawn-text` paths.
4. Drop `app/api/scans/[id]/permission/route.ts` (no DB migration to undo).

No persistent state changes — pure code.

## Dependencies

- `@agentclientprotocol/sdk@0.21.0` (npm).
- Optional: `@zed-industries/codex-acp` resolved via `npx` (no install).
- No DB migration. No env var changes.

## Success Criteria

- [ ] `bun run test` green; new transport/client/bridge tests pass with TDD.
- [ ] `acp.ts` contains zero regex parsing of agent output.
- [ ] All four fixed agents (`gemini`, `opencode`, `qwen`, `codex`) initialize an ACP session and stream `sessionUpdate` events end-to-end in integration test.
- [ ] Permission request from agent surfaces `PermissionDialog` in UI; user choice unblocks agent within <500ms.
- [ ] Scan cancel kills process AND rejects any pending permission promises.
- [ ] No `.obt` paths hardcoded — uses `lib/config/workspace.ts` helpers.
- [ ] Zod validation on `/api/scans/[id]/permission` request body.
