# Exploration: stable-provider-surfaces

**Project**: open-security
**Date**: 2026-05-04
**Status**: Complete
**Engram ID**: 321 (topic_key: `sdd/stable-provider-surfaces/explore`)

---

## Problem Statement

The current provider layer uses a single transport (child process spawn) feeding three
parsers that differ by agent. Two agents (qwen, ollama) rely on regex-based plain-text
parsing (level 5 — prohibited). Five agents use hardcoded per-agent JSON field names
(`native-to-findings.ts` — fragile, breaks silently on CLI version changes).

No agent currently uses an SDK, HTTP API, or ACP — despite all major agents offering
at least one stable structured surface.

---

## Current Architecture

```
stage2-llm.ts
  └── ProviderClient.scan()
        └── makeCliClient() [stage-routing.ts]
              └── spawnProvider() [spawn.ts]
                    ├── claude    → parseClaudeStreamJson()   (level 4)
                    ├── opencode  → parseNativeToFindings()   (level 4)
                    ├── codex     → parseNativeToFindings()   (level 4)
                    ├── gemini    → parseNativeToFindings()   (level 4)
                    ├── cursor    → parseNativeToFindings()   (level 4)
                    ├── qwen      → parsePlain() REGEX        (level 5 ❌)
                    └── ollama    → parsePlain() REGEX        (level 5 ❌)
```

### Zero-change zone (verified)
- `lib/providers/index.ts` — ProviderClient interface stays identical
- `lib/pipeline/stage2-llm.ts` — zero changes
- `lib/providers/api/` — Vercel AI SDK path untouched
- `lib/config/schema.ts` — model string format unchanged (`cli:<id>`, `api:<p>:<m>`)
- `lib/sources/gitlab.ts` — unrelated to provider transport

---

## Surface Map (target state)

| Agent | Current | Target | Approach | Blocker |
|-------|---------|--------|----------|---------|
| claude | 4 — `--stream-json` flag | 1 — SDK | `@anthropic-ai/claude-agent-sdk` | None |
| opencode | 4 — `--format json` flag | 4 — keep | JSON flag works; SDK requires `opencode serve` daemon — DEFERRED | Daemon lifecycle |
| ollama | **5 — plain text regex** | 2 — HTTP | `fetch` to `localhost:11434/api/chat` (OpenAI-compat) | None |
| gemini | 4 — `--output-format stream-json` | 3 — ACP | JSON-RPC over `gemini acp` stdio | Handshake impl |
| codex | 4 — `--json` flag | 3 — ACP | JSON-RPC over ACP (Zed adapter) | Handshake impl |
| qwen | **5 — plain text regex** | 4 — JSON flag | `qwen -p prompt --output-format json` headless | None |
| cursor-agent | 4 — `--output-format json` | 4 — keep | Already at target | — |

---

## Blast Radius

### Files to create
- `lib/providers/sdk/claude.ts` — wraps `@anthropic-ai/claude-agent-sdk`
- `lib/providers/transport/http.ts` — generic streaming HTTP client (Ollama)
- `lib/providers/transport/acp.ts` — ACP JSON-RPC 2.0 over stdio

### Files to modify
- `lib/providers/cli/agents.ts` — add transport discriminant, fix qwen buildArgs
- `lib/providers/stage-routing.ts` — extend makeCliClient() switch for new transports

### Files to delete
- `lib/providers/cli/parsers/plain.ts` — eliminated (no agent uses regex after migration)
- `lib/providers/cli/parsers/claude-stream-json.ts` — logic moves to `sdk/claude.ts`
- `lib/providers/cli/parsers/native-to-findings.ts` — reduced or deleted

### Tests to update
- `tests/unit/providers/native-to-findings.test.ts` — port to new transport tests
- Add: `tests/unit/providers/sdk-claude.test.ts`
- Add: `tests/unit/providers/transport-http.test.ts`
- Add: `tests/unit/providers/transport-acp.test.ts`

---

## Key Risks

1. **`@anthropic-ai/claude-agent-sdk` pre-1.0** (currently 0.2.x): breaking changes expected.
   Pin exact version. Write integration tests against real binary.

2. **ACP handshake for gemini/codex**: Silent failure if `initialize` is misimplemented.
   The JSON-RPC lifecycle (`initialize → prompt → stream notifications → result`) must be
   correct. Requires integration tests against real binaries.

3. **opencode SDK daemon assumption**: `@opencode-ai/sdk` wraps `opencode serve` HTTP API,
   which requires a running server process. Breaks the stateless spawn-on-demand model.
   Recommended: DEFER opencode SDK upgrade. Keep `--format json` flag (current).

4. **Test coverage regression**: `native-to-findings.test.ts` has 14+ tests that must be
   migrated to new transport unit tests before deleting old parsers.

---

## Recommendation

Phased within this single change:

- **Phase A** (zero new packages): qwen → JSON flag; ollama → HTTP. Deletes `plain.ts`.
- **Phase B** (one new package): claude → `@anthropic-ai/claude-agent-sdk` SDK.
- **Phase C** (no new packages): gemini + codex → ACP JSON-RPC transport.
- **Deferred**: opencode SDK (daemon lifecycle design needed separately).
