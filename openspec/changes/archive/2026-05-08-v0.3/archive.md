# Archive: v0.3 — CVE Hunter + Investigation Console + Playbooks + Secret Timeline

**Status**: ARCHIVED
**Date**: 2026-05-08
**Observation ID**: 494

---

## Summary

v0.3 is complete and archived. All 67 tasks implemented under Strict TDD Mode. 433 v0.3-specific tests pass (100%). No critical issues. Change adds targeted CVE investigation (Hunt), mid-flight scan steering (Investigation Console), reusable security templates (Playbooks), and forensic secret timelines to open-security.

---

## Artifacts

| Artifact | Backend | ID |
|----------|---------|-----|
| Proposal | engram | 416 |
| Spec | engram | 418 |
| Design | engram | 419 |
| Tasks | engram | 420 |
| Apply Progress | engram | 438 |
| Verify Report | engram | 441 |
| Archive Report | engram | 494 |

---

## Completeness

- **Tasks**: 67/67 complete (T-001 through T-067)
- **Tests**: 433/433 GREEN
- **Key files**: 28/28 present
- **Builtins**: 5/5 present
- **Verify**: PASS WITH WARNINGS (2 documentation/design deviations, no blockers)

---

## Capabilities Added

1. **CVE Hunter**: Targeted CVE/GHSA investigation as scan strategy
2. **Investigation Console**: Mid-flight prompt injection, plan editing, tool-call rejection, fork from checkpoint
3. **Playbooks**: `.obt-skill` YAML templates with 5 first-party audits (audit-auth-surface, find-ssrf, pre-release-sweep, deserialization-sweep, oauth-flow-review)
4. **Secret Timeline**: Forensic exposure windows with introducing commit, blame, suspected deploys

---

## Integration

- v0.1 replay parity preserved
- v0.2 surfaces unaffected (orthogonal to Diff Mode, Watch Mode, SARIF)
- New egress: `api.osv.dev` only
- All behind `OBT_CONSOLE_V2` feature flag for safe rollback

---

## Warnings

1. `openspec/changes/v0.3/tasks.md` — File never updated with [x] marks during apply. Engram apply-progress (#438) has correct state.
2. `ScanStrategy.preStage0()` — Design inlines into run() instead of exposing as interface method. Functional behavior correct; future hook extensibility concern.

---

## Rollback

Each capability independent. Migrations reversible. No permanent state changes. Drop tables + delete code = clean rollback.

---

## Reference

Full archive report: see engram observation #494 for complete traceability, risk mitigation, lessons learned, and success criteria validation.

**Change Closed**: 2026-05-08 ✅
