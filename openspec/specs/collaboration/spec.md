# Spec: Collaboration — Comments, Assignments, and Audit Trail

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: collaboration

---

## Requirement: Finding Comments

The system SHALL allow users to add text notes to any finding, stored in a `finding_comments` table with `created_at` and `actor` fields.

### Scenario: User adds a comment

- GIVEN a finding detail page is open
- WHEN the user submits a text note
- THEN the comment SHALL be saved with `finding_id`, `actor`, `body`, and `created_at`
- AND the comment SHALL appear in the finding's comment thread immediately

### Scenario: Comment thread displays in order

- GIVEN a finding has multiple comments
- WHEN the finding detail page loads
- THEN comments SHALL be displayed in ascending `created_at` order

### Scenario: @mention stored verbatim

- GIVEN a comment contains `@alice`
- WHEN the comment is saved
- THEN the mention SHALL be stored as-is with no notification dispatched (notifications deferred to v1.1)

---

## Requirement: Finding Assignment

The system SHALL allow assigning a finding to an owner (free-text string or value from the `authors` table), with an auditable assignment history.

### Scenario: Assign finding to owner

- GIVEN a finding is unassigned
- WHEN a user assigns it to `@bob`
- THEN an assignment record SHALL be created with `finding_id`, `assignee`, `actor`, and `created_at`
- AND the finding detail page SHALL show the current assignee

### Scenario: Assignment history is auditable

- GIVEN a finding has been reassigned twice
- WHEN the assignment history section is viewed
- THEN all assignment records SHALL be displayed with actor and timestamp
