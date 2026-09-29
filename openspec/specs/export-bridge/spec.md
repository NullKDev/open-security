# Spec: Export Bridge — Two-Way Integration with External Tools

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: export-bridge

---

## Requirement: Jira Ticket Creation

The system SHALL create Jira tickets via the Jira REST API v3 with: summary, description (finding detail + reproduction steps), priority (mapped from severity), and labels. Jira base URL, project key, and API token SHALL be required and stored encrypted at rest.

### Scenario: Create Jira ticket from finding

- GIVEN Jira integration is configured (base URL, project key, API token)
- WHEN the user triggers "Export to Jira" for a finding
- THEN a ticket SHALL be created in the configured project with severity-mapped priority and finding labels

### Scenario: Idempotent re-export

- GIVEN a Jira ticket already exists for a finding (ticket key stored on the finding)
- WHEN the user triggers "Export to Jira" again
- THEN no duplicate ticket SHALL be created
- AND the existing ticket key SHALL be returned

### Scenario: Missing Jira credentials

- GIVEN Jira integration is not configured
- WHEN the user attempts to export to Jira
- THEN the system SHALL display a configuration error and SHALL NOT attempt an API call

---

## Requirement: Slack Weekly Digest

The system SHALL send a weekly Slack digest via an incoming webhook URL summarizing: new findings by severity, fixed findings, regression count, and MTTR delta.

### Scenario: Weekly digest is sent

- GIVEN a Slack webhook URL is configured
- WHEN the weekly digest schedule triggers
- THEN a message SHALL be posted with counts for new/fixed/regressed findings and MTTR delta

### Scenario: Digest is idempotent within the same week

- GIVEN a digest was already sent for the current week
- WHEN the digest job runs again in the same week
- THEN no duplicate message SHALL be sent to Slack

---

## Requirement: GitHub Code Scanning SARIF Upload

The system SHALL upload findings as SARIF 2.1.0 to the GitHub Code Scanning API (`POST /repos/{owner}/{repo}/code-scanning/sarifs`) using a user-supplied PAT with `security_events` scope.

### Scenario: SARIF upload succeeds

- GIVEN a GitHub PAT and repo are configured
- WHEN the user triggers SARIF upload
- THEN findings SHALL be serialized to valid SARIF 2.1.0 and uploaded
- AND the GitHub Security tab SHALL reflect the uploaded results

### Scenario: SARIF upload failure is logged

- GIVEN the GitHub API returns an error
- WHEN the upload is attempted
- THEN the error SHALL be recorded in `scan_events`
- AND the system SHALL retry with exponential backoff
