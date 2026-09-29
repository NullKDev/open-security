# Spec: OSV Enrichment — OSV.dev Advisory Lookup and CVE Mapping

**Change**: v1.0  
**Date**: 2026-05-06  
**Domain**: osv-enrichment

---

## Requirement: OSV Advisory Lookup

The system SHALL query OSV.dev for every CVE/GHSA ID in `findings.cve_ids` at scan completion, populating: affected versions, fix version, CVSS severity, and aliases (CVE ↔ GHSA). Results SHALL be cached in `cve_scores` with a 24-hour TTL. NVD SHALL serve as fallback only.

### Scenario: OSV enrichment on scan completion

- GIVEN a scan produces findings with CVE IDs
- WHEN the scan reaches Stage 4
- THEN OSV.dev SHALL be queried for each CVE ID
- AND affected versions, fix version, and CVSS SHALL be written to `cve_scores`

### Scenario: Cache hit skips network call

- GIVEN a CVE ID was enriched within the past 24 hours
- WHEN the same CVE appears in a new scan
- THEN the cached record SHALL be used without querying OSV.dev

### Scenario: OSV unavailable falls back to NVD

- GIVEN OSV.dev returns an error or times out
- WHEN enrichment runs for a CVE ID
- THEN NVD SHALL be queried as fallback (if API key is configured)
- AND the finding SHALL be stored with whatever data was obtained

### Scenario: No CVE IDs — enrichment skipped

- GIVEN a scan produces findings with no `cve_ids`
- WHEN enrichment runs
- THEN no OSV or NVD calls SHALL be made
