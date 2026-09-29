# Archive Report: stable-provider-surfaces

**Archived**: 2026-05-04
**Verdict**: PASS WITH WARNINGS
**Artifact Store**: hybrid (openspec + engram)

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| provider-transports | Created | Full new spec — 5 requirements, TransportKind enum + sdk/http/acp/spawn-json |
| provider-cli | Created | Full new spec — 1 requirement (transport dispatch), 3 removed requirements documented in delta |

## Archive Contents

- explore.md ✅
- proposal.md ✅
- specs/provider-transports/spec.md ✅
- specs/provider-cli/spec.md ✅
- design.md ✅
- tasks.md ✅ (29/29 tasks complete)
- verify-report.md ✅

## Source of Truth Updated

- `openspec/specs/provider-transports/spec.md` — NEW
- `openspec/specs/provider-cli/spec.md` — NEW

## Key Changes Shipped

- `TransportKind = 'sdk' | 'http' | 'acp' | 'spawn-json'` added to AgentDef
- makeCliClient() dispatches on transport kind — no more stream-format switch
- lib/providers/sdk/claude.ts — SDK transport via @anthropic-ai/claude-agent-sdk@0.2.8
- lib/providers/transport/http.ts — HTTP transport for ollama (fetch + probe)
- lib/providers/transport/acp.ts — ACP/JSON-RPC 2.0 transport for gemini + codex
- plain.ts, claude-stream-json.ts — deleted (Level 5 regex parsers gone)

## Standing Warning

codex acpArgs (`['--full-auto', '--protocol', 'json-rpc']`) are placeholder assumptions — verify against real binary before production use.

## SDD Cycle Complete

explore → propose → spec → design → tasks → apply → verify → **archive** ✅
