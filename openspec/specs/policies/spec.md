# Spec: Policies — Smart Ignore Rules and Finding Evaluation

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: policies

---

## Requirement: Policy File Loading

The system SHALL load policy rules from `~/.obt/policies.yaml` (global) and `.obt/policies.yaml` (workspace). Workspace rules SHALL override global rules for overlapping path globs.

### Scenario: Workspace policy overrides global

- GIVEN a global policy sets `severity_floor: medium` for `**/*.js`
- AND a workspace policy sets `severity_floor: high` for `**/*.js`
- WHEN a scan completes and Stage 4 evaluates findings
- THEN the workspace floor (`high`) SHALL apply, not the global

### Scenario: Global policy used when no workspace policy exists

- GIVEN a global policy file exists
- AND no workspace `.obt/policies.yaml` is present
- WHEN Stage 4 evaluates findings
- THEN global rules SHALL apply without error

### Scenario: Missing policy files

- GIVEN neither global nor workspace policy files exist
- WHEN Stage 4 runs
- THEN evaluation SHALL proceed with no rules applied and no error raised

---

## Requirement: Policy Rule Types

The system SHALL support three rule types per path glob: `severity_floor`, `ignore_rule` (with optional `expiry` date), and `owner` assignment.

### Scenario: ignore_rule suppresses finding

- GIVEN an `ignore_rule` matches a finding's path and rule ID
- AND the rule has no `expiry` or expiry is in the future
- WHEN Stage 4 evaluates that finding
- THEN the finding SHALL be stored with `status='policy_suppressed'` and the matching rule ID

### Scenario: Expired ignore_rule does not suppress

- GIVEN an `ignore_rule` has an `expiry` date in the past
- WHEN Stage 4 evaluates a matching finding
- THEN the finding SHALL NOT be suppressed
- AND a warning SHALL be surfaced in the UI settings page for that expired rule

### Scenario: severity_floor annotation

- GIVEN a `severity_floor: high` rule matches a finding with `severity: low`
- WHEN Stage 4 evaluates it
- THEN the finding SHALL remain in the queue with reduced display priority, not removed
