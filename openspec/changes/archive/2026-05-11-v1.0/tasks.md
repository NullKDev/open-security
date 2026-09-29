# Tasks: v1.0 — Policies + Collaboration + Export Bridge + OSV/Socket Integrations

> Strict TDD Mode active. Every implementation task (GREEN) is preceded by a test task (RED).
> Runner: `bun test` (Vitest 4). No `console.log`. Zod on all API routes. JSDoc on all exports.

---

## Phase 1: Foundation — Schema, Security, Types

- [x] T-001 — Write migration file `drizzle/0013_v1_0.sql` `[size: M]`
- [x] T-002 — Update Drizzle schema `lib/db/schema.ts` to reflect 0013 additions `[size: M]`
- [x] T-003 — Write tests (RED) for `lib/security/machine-key.ts` `[size: XS]`
- [x] T-004 — Implement `lib/security/machine-key.ts` `[size: S]`
- [x] T-005 — Write tests (RED) for `lib/security/secret-store.ts` `[size: S]`
- [x] T-006 — Implement `lib/security/secret-store.ts` `[size: S]`
- [x] T-007 — Implement `lib/security/redact.ts` (extended) `[size: XS]`

## Phase 2: Policy Engine

- [x] T-008 — Write tests (RED) for `lib/policies/rule-loader.ts` `[size: S]`
- [x] T-009 — Implement `lib/policies/rule-loader.ts` `[size: S]`
- [x] T-010 — Write tests (RED) for `lib/policies/engine.ts` `[size: S]`
- [x] T-011 — Implement `lib/policies/engine.ts` `[size: S]`
- [x] T-012 — Extend `lib/pipeline/stage4-filter.ts` to call policy engine `[size: S]`

## Phase 3: Cross-Scanner Consensus

- [x] T-013 — Write tests (RED) for `lib/consensus/consensus-engine.ts` `[size: S]`
- [x] T-014 — Implement `lib/consensus/consensus-engine.ts` `[size: S]`
- [x] T-015 — Wire consensus engine into `lib/pipeline/stage4-filter.ts` `[size: S]`

## Phase 4: OSV Enrichment v2

- [x] T-016 — Write tests (RED) for `lib/enrichers/cache.ts` `[size: XS]`
- [x] T-017 — Implement `lib/enrichers/cache.ts` `[size: XS]`
- [x] T-018 — Write tests (RED) for `lib/enrichers/osv.ts` `[size: S]`
- [x] T-019 — Implement `lib/enrichers/osv.ts` `[size: M]`

## Phase 5: Socket.dev Integration

- [x] T-020 — Write tests (RED) for `lib/enrichers/socket.ts` `[size: S]`
- [x] T-021 — Implement `lib/enrichers/socket.ts` `[size: M]`
- [x] T-022 — Implement `lib/enrichers/socket-alert-mapper.ts` `[size: XS]`
- [x] T-023 — Wire Socket enricher into enrichment runner `[size: S]`

## Phase 6: Collaboration Layer

- [x] T-024 — Write tests (RED) for `lib/repos/finding-comments.repo.ts` `[size: S]`
- [x] T-025 — Implement `lib/repos/finding-comments.repo.ts` `[size: S]`
- [x] T-026 — Write tests (RED) for `lib/repos/finding-assignments.repo.ts` `[size: S]`
- [x] T-027 — Implement `lib/repos/finding-assignments.repo.ts` `[size: S]`
- [x] T-028 — Create API routes for comments `app/api/findings/[id]/comments/route.ts` `[size: S]`
- [x] T-029 — Create API route for assignment `app/api/findings/[id]/assignment/route.ts` `[size: S]`

## Phase 7: Export Bridge

- [x] T-030 — Implement `lib/exporters/finding-shape.ts` `[size: XS]`
- [x] T-031 — Write tests (RED) for `lib/exporters/jira.ts` `[size: S]`
- [x] T-032 — Implement `lib/exporters/jira.ts` `[size: M]`
- [x] T-033 — Write tests (RED) for `lib/exporters/slack.ts` `[size: S]`
- [x] T-034 — Implement `lib/exporters/slack.ts` `[size: S]`
- [x] T-035 — Wire Slack digest into `instrumentation.ts` weekly cron `[size: XS]`
- [x] T-036 — Write tests (RED) for `lib/exporters/github-code-scanning.ts` `[size: S]`
- [x] T-037 — Implement `lib/exporters/github-code-scanning.ts` `[size: M]`
- [x] T-038 — Create API route `app/api/findings/[id]/export/jira/route.ts` `[size: XS]`
- [x] T-039 — Create API route `app/api/scans/[id]/export/github-sarif/route.ts` `[size: XS]`

## Phase 8: Settings UI + Navigation

- [x] T-040 — Create `/settings/integrations` page `[size: M]`
- [x] T-041 — Create `PUT /api/integrations/[target]/route.ts` `[size: S]`
- [x] T-042 — Create `/settings/policies` page `[size: M]`
- [x] T-043 — Create `PUT /api/policies/route.ts` `[size: XS]`

## Phase 9: UI Components — Findings Detail

- [x] T-044 — Implement `<CollaborationPanel>` component `[size: M]`
- [x] T-045 — Implement `<ExportPanel>` component `[size: S]`
- [x] T-046 — Implement `<ConsensusBadge>` component `[size: XS]`
- [x] T-047 — Add panels to finding detail page `[size: S]`
- [x] T-048 — Add `<ConsensusBadge>` to QueueItem + filter `[size: S]`

## Phase 10: Cleanup + Integration Verification

- [x] T-049 — Add feature flags to `ObtConfig` `[size: XS]`
- [x] T-050 — Verify Stage 1 exposes scanner manifest `[size: S]`
- [x] T-051 — JSDoc audit: all exported functions in new files `[size: S]`
- [x] T-052 — Full integration smoke test `[size: M]`

---

**Total**: 52/52 complete
