# Tasks: stable-provider-surfaces

## Phase 1: Foundation — TransportKind + Routing Skeleton

- [x] 1.1 Add `export type TransportKind = 'sdk' | 'http' | 'acp' | 'spawn-json'` to `lib/providers/cli/agents.ts`
- [x] 1.2 Add `transport: TransportKind` field to `AgentDef` interface in `lib/providers/cli/agents.ts`
- [x] 1.3 Assign final transport values to all 7 `AGENT_DEFS` entries (claude→sdk, ollama→http, gemini/codex→acp, opencode/cursor-agent/qwen→spawn-json)
- [x] 1.4 Update `makeCliClient()` in `lib/providers/stage-routing.ts`: replace `switch (streamFormat)` with `switch (def.transport)`; add sdk/http/acp branches; keep spawn-json identical to current behavior
- [x] 1.5 Update `tests/unit/providers/stage-routing.test.ts`: assert each agent resolves to the correct `TransportKind`

## Phase 2: Phase A — qwen JSON flag + Ollama HTTP transport

- [x] 2.1 Write tests for HTTP transport in `tests/unit/providers/transport-http.test.ts`: probe success, probe failure (daemon down), streaming events emitted
- [x] 2.2 Create `lib/providers/transport/http.ts`: `GET /api/version` probe + streaming `fetch` to `http://localhost:11434/api/chat`; returns `AsyncIterable<ProviderEvent>`
- [x] 2.3 Wire `transport: 'http'` branch in `makeCliClient()` to call `lib/providers/transport/http.ts`
- [x] 2.4 Update ollama `AGENT_DEFS` entry: set `transport: 'http'`
- [x] 2.5 Update qwen `AGENT_DEFS` entry: set `transport: 'spawn-json'`, change `streamFormat` to `'json-event-stream'`, update `buildArgs` to `['-p', prompt, '--output-format', 'json']`
- [x] 2.6 Delete `lib/providers/cli/parsers/plain.ts`
- [x] 2.7 Delete `tests/unit/providers/plain.test.ts`

## Phase 3: Phase B — Claude SDK transport

- [x] 3.1 Add `@anthropic-ai/claude-agent-sdk` to `package.json` (exact version pin: 0.2.8)
- [x] 3.2 Write tests for SDK transport in `tests/unit/providers/sdk-claude.test.ts`
- [x] 3.3 Create `lib/providers/sdk/claude.ts`: wraps SDK `query()` API; maps SDK events to `ProviderEvent`; returns `AsyncIterable<ProviderEvent>`
- [x] 3.4 Wire `transport: 'sdk'` branch in `makeCliClient()` to call `lib/providers/sdk/claude.ts`
- [x] 3.5 Update claude `AGENT_DEFS` entry: set `transport: 'sdk'`
- [x] 3.6 Delete `lib/providers/cli/parsers/claude-stream-json.ts`
- [x] 3.7 Delete `tests/unit/providers/claude-stream-json.test.ts`

## Phase 4: Phase C — ACP transport (gemini + codex)

- [x] 4.1 Write tests for ACP transport in `tests/unit/providers/transport-acp.test.ts`: `initialize` handshake, prompt → events, stream close on completion
- [x] 4.2 Create `lib/providers/transport/acp.ts`: JSON-RPC 2.0 over stdio via `spawnProvider`; sends `initialize` before `prompt`; maps notifications to `ProviderEvent`
- [x] 4.3 Wire `transport: 'acp'` branch in `makeCliClient()` to call `lib/providers/transport/acp.ts`
- [x] 4.4 Update gemini `AGENT_DEFS` entry: set `transport: 'acp'`, `acpArgs: ['acp']`
- [x] 4.5 Update codex `AGENT_DEFS` entry: set `transport: 'acp'`, `acpArgs: ['--full-auto', '--protocol', 'json-rpc']` (TODO: verify)
- [x] 4.6 Remove `handleGemini()` and `handleCodex()` from `lib/providers/cli/parsers/native-to-findings.ts` (opencode + cursor-agent cases stay)
- [x] 4.7 Remove gemini + codex test cases from `tests/unit/providers/native-to-findings.test.ts`
- [x] 4.8 Add transport dispatch assertions for gemini + codex to `tests/unit/providers/stage-routing.test.ts`

## Phase 5: Documentation

- [x] 5.1 Update JSDoc on `makeCliClient()` in `stage-routing.ts` to describe the new transport dispatch
- [x] 5.2 Update JSDoc on `AgentDef` interface describing the `transport` field

## Notes

- `native-to-findings.ts` was NOT deleted (opencode + cursor-agent still use it). Only `handleGemini` and `handleCodex` were removed.
- `spawn.ts` received a minimal addition: `pipeStdin?: boolean` option to support the ACP transport's writable stdin requirement.
- ACP `acpArgs` for gemini and codex are best-effort assumptions — must be verified against real binaries before Phase C is considered production-ready.
