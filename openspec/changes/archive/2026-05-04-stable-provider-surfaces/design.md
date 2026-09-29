# Design: stable-provider-surfaces

## Technical Approach

Add a `transport: TransportKind` discriminant to `AgentDef`. `makeCliClient()` in `stage-routing.ts` routes by this field, instantiating a dedicated module per transport kind. Three new modules are created (`sdk/claude.ts`, `transport/http.ts`, `transport/acp.ts`); three parsers deleted post-migration. `ProviderClient` interface and `stage2-llm.ts` are untouched throughout.

## Architecture Decisions

### Decision: Extend AgentDef, don't replace it

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add `transport` alongside existing fields | Minimal diff; `streamFormat` ignored in sdk/http/acp branches | ✅ Chosen |
| Replace `streamFormat` with `transport` | Cleaner long-term; larger diff touching all agent entries | Rejected |
| Split AgentDef into discriminated union | Most type-safe; high blast radius | Rejected |

`streamFormat: 'plain'` is deleted naturally when qwen/ollama migrate. No explicit removal step needed.

### Decision: opencode stays at spawn-json (level 4) for this change

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Keep opencode on `--format json` via stdin | Zero risk; explore found daemon lifecycle conflict | ✅ Chosen |
| Migrate opencode to ACP alongside gemini/codex | Needs investigation; opencode ACP may require `opencode serve` daemon | Deferred |

Phase C covers gemini + codex only. opencode moves in a follow-up after ACP mode is verified.

### Decision: ACP transport reuses spawnProvider internally

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `acp.ts` wraps `spawnProvider()` | Inherits ENOENT handling, PassThrough cleanup, env filtering | ✅ Chosen |
| Native `child_process.spawn` in acp.ts | Duplicates error-handling that already exists in spawn.ts | Rejected |

## Data Flow

```
stage2-llm.ts
    ↓
createProviderForStage() → createCliProvider() → makeCliClient(def, modelId)
    ↓ switch(def.transport)
    ├── 'sdk'        → lib/providers/sdk/claude.ts        → claude-agent-sdk → ProviderEvent
    ├── 'http'       → lib/providers/transport/http.ts    → fetch(localhost:11434) → ProviderEvent
    ├── 'acp'        → lib/providers/transport/acp.ts     → spawnProvider + JSON-RPC stdio → ProviderEvent
    └── 'spawn-json' → spawnProvider() → json-event-stream parser → ProviderEvent
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `lib/providers/cli/agents.ts` | Modify | Add `transport: TransportKind`; update qwen `buildArgs` → `--output-format json`; set ollama `transport: 'http'` |
| `lib/providers/stage-routing.ts` | Modify | `makeCliClient()` switches on `def.transport`; imports new transport modules |
| `lib/providers/sdk/claude.ts` | Create | Wraps `@anthropic-ai/claude-agent-sdk`; returns `AsyncIterable<ProviderEvent>` |
| `lib/providers/transport/http.ts` | Create | Streaming `fetch` to `localhost:11434/api/chat`; probes `/api/version` before scan |
| `lib/providers/transport/acp.ts` | Create | JSON-RPC 2.0 over stdio; `initialize` → `prompt` lifecycle; maps notifications to events |
| `lib/providers/cli/parsers/plain.ts` | Delete | Phase A — no agent reaches this path post-migration |
| `lib/providers/cli/parsers/claude-stream-json.ts` | Delete | Phase B — claude moves to SDK transport |
| `lib/providers/cli/parsers/native-to-findings.ts` | Delete | Phase C — gemini/codex move to ACP (opencode/cursor-agent stay on spawn-json) |
| `tests/unit/providers/plain.test.ts` | Delete | Parser gone |
| `tests/unit/providers/claude-stream-json.test.ts` | Delete | Parser gone |
| `tests/unit/providers/native-to-findings.test.ts` | Modify | Remove gemini/codex cases; keep opencode + cursor-agent cases |
| `tests/unit/providers/sdk-claude.test.ts` | Create | SDK transport: mock `claude-agent-sdk`; verify event mapping |
| `tests/unit/providers/transport-http.test.ts` | Create | HTTP transport: mock `fetch`; recorded NDJSON fixtures |
| `tests/unit/providers/transport-acp.test.ts` | Create | ACP transport: recorded stdio fixtures via PassThrough |
| `tests/unit/providers/stage-routing.test.ts` | Modify | Add routing assertions for sdk/http/acp dispatch per agent |

## Interfaces / Contracts

```typescript
// lib/providers/cli/agents.ts — new field only
export type TransportKind = 'sdk' | 'http' | 'acp' | 'spawn-json'

export interface AgentDef {
  // ... all existing fields unchanged ...
  transport: TransportKind  // NEW routing discriminant
}
```

`ProviderClient` in `lib/providers/index.ts` — **zero changes**.

`stage2-llm.ts` — **zero changes**.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | SDK transport event mapping | Mock `@anthropic-ai/claude-agent-sdk` module |
| Unit | HTTP transport streaming + daemon probe | Mock `fetch`; recorded Ollama NDJSON fixtures |
| Unit | ACP handshake + notification mapping | PassThrough-based recorded stdio fixtures |
| Unit | Transport dispatch routing | Assert `makeCliClient` instantiates correct type per agent |
| Unit | qwen spawn-json parse | json-event-stream parser already tested; update buildArgs test |

Tests MUST be written before implementation (TDD: RED → GREEN → REFACTOR).

## Migration / Rollout

Phases A → B → C as in proposal, each an independent commit. Rollback = `git revert` of that commit. The `transport` field on `AgentDef` is the rollback switch — reverting restores old value and old parser path. Phases revert in C → B → A order.

## Open Questions

- [ ] Does `opencode` support ACP (JSON-RPC 2.0 over stdio) headless mode? If confirmed, add Phase D to migrate opencode in a follow-up change.
