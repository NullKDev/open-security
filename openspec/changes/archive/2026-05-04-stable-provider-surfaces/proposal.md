# Proposal: stable-provider-surfaces

## Intent

The provider layer routes seven CLI agents through a single brittle transport (child process spawn + ad-hoc parsers). Two agents (`ollama`, `qwen`) sit at the **prohibited level 5** — plain-text regex parsing that breaks silently on any CLI update. Five more rely on hardcoded JSON field mappings in `native-to-findings.ts`, fragile to vendor schema changes. Zero integrations use the stable surfaces vendors actually publish (SDK, HTTP, ACP). This change replaces those transports with the most stable surface each agent offers, while preserving local-first execution (every CLI must remain installed locally).

## Scope

### In Scope
- New `lib/providers/sdk/claude.ts` wrapping `@anthropic-ai/claude-agent-sdk` (pinned exact version)
- New `lib/providers/transport/acp.ts` — JSON-RPC 2.0 over stdio client; serves opencode, gemini, codex
- New `lib/providers/transport/http.ts` — streaming HTTP client for Ollama at `localhost:11434`
- Update `lib/providers/cli/agents.ts` with transport discriminant + qwen `--output-format json` headless flag
- Extend `lib/providers/stage-routing.ts` switch to dispatch sdk/http/acp without breaking signatures
- Delete `parsers/plain.ts`, `parsers/native-to-findings.ts`, `parsers/claude-stream-json.ts` once dependents migrate
- Update affected unit tests; preserve coverage

### Out of Scope
- `lib/providers/index.ts` `ProviderClient` interface (byte-identical contract)
- `lib/pipeline/stage2-llm.ts` — zero changes
- `lib/providers/api/` Vercel AI SDK path (untouched)
- `lib/config/schema.ts` model string format (`cli:<id>`, `api:<p>:<m>` unchanged)
- Remote API integrations (live in `api/`, not affected)

## Capabilities

### New Capabilities
- `provider-transports`: catalogs the four transport kinds (sdk, http, acp, spawn) and the agent → transport mapping with required surface per agent

### Modified Capabilities
- `provider-cli`: existing CLI capability changes from "spawn + parse" model to a transport-dispatcher that routes per agent transport kind; `ProviderClient` contract unchanged but internal routing semantics evolve

## Approach

Per-agent target surfaces (confirmed):

| Agent | Target | Surface |
|-------|--------|---------|
| claude | SDK (lvl 1) | `@anthropic-ai/claude-agent-sdk` |
| ollama | HTTP (lvl 2) | `fetch` → `localhost:11434/api/chat` |
| opencode, gemini, codex | ACP (lvl 3) | shared `acp.ts` JSON-RPC client |
| qwen | JSON flag (lvl 4) | `qwen -p prompt --output-format json` |
| cursor-agent | unchanged (lvl 4) | already at target |

Three implementation phases, each independently revertable:

- **Phase A (low risk)**: qwen → JSON flag, ollama → HTTP. Deletes `plain.ts`. Self-contained.
- **Phase B (medium risk)**: claude → SDK. Adds one pinned dependency. Deletes `claude-stream-json.ts`.
- **Phase C (medium-high risk)**: opencode + gemini + codex → ACP via shared transport. Deletes `native-to-findings.ts`. No new packages.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/providers/sdk/claude.ts` | New | SDK wrapper |
| `lib/providers/transport/acp.ts` | New | Shared JSON-RPC client |
| `lib/providers/transport/http.ts` | New | Streaming HTTP for Ollama |
| `lib/providers/cli/agents.ts` | Modified | Transport discriminant + qwen args |
| `lib/providers/stage-routing.ts` | Modified | Dispatch switch extended |
| `lib/providers/cli/parsers/*` | Removed | All three parsers deleted post-migration |
| `tests/unit/providers/*` | Modified | Native-parser tests replaced by transport tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Claude SDK pre-1.0 API churn | Med | Pin exact version; isolate in `sdk/claude.ts`; cover with integration test |
| ACP handshake (initialize/prompt/notifications) misimplemented → silent scan failures | Med | Build against gemini ACP reference impl first; add transport-level tests with recorded fixtures |
| Test coverage drop deleting `native-to-findings.test.ts` (14+ tests) | Med | Port equivalent tests to ACP/SDK transports before deleting parsers |
| Ollama HTTP endpoint unavailable when daemon not running | Low | Probe `/api/version` before scan; surface clear error |
| Qwen `--output-format json` flag absent in older builds | Low | Probe binary version in `resolve.ts`; document minimum CLI version |

## Rollback Plan

Each phase ships as an independent commit with feature-flag-style transport selection in `agents.ts`. Reverting a phase is a single-commit revert: the deleted parser files are restored, the transport dispatch falls back to `spawn`, and no schema or config migration runs. Phases C → B → A is the safe revert order. The `ProviderClient` contract is invariant, so reverting any phase cannot break `stage2-llm.ts`.

## Dependencies

- `@anthropic-ai/claude-agent-sdk` (NEW, exact-pinned, ~0.2.x)
- No other new packages (ACP = native `child_process` + JSON-RPC; HTTP = native `fetch`)

## Success Criteria

- [ ] Zero agents execute through `parsers/plain.ts` (file deleted)
- [ ] Zero agents execute through `parsers/native-to-findings.ts` (file deleted)
- [ ] `ProviderClient` interface in `lib/providers/index.ts` byte-identical to pre-change
- [ ] `lib/pipeline/stage2-llm.ts` unmodified
- [ ] Each agent's stage-2 scan produces `ProviderEvent` stream equivalent to pre-change behavior on a fixture repo
- [ ] Test coverage on `lib/providers/` ≥ pre-change coverage
- [ ] All seven agents resolved & scannable end-to-end via SSE pipeline
