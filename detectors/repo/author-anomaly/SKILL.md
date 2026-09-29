---
id: author-anomaly
severity: low
description: Detects anomalous author patterns in git history that may indicate compromised accounts, sock-puppet contributors, or identity obfuscation. Flags single-commit authors, domain outliers, and name/email mismatches.
---

# Author-anomaly Detector

## Detection Rules

### 1. Single-Commit Authors
Authors with exactly one commit in the entire repository history are flagged. These may be:
- Sock-puppet accounts used to inject malicious code
- Contributors whose access was quickly revoked
- Automated accounts that were configured once

### 2. Domain Outliers
When all authors except one use the same email domain (e.g., `@company.com`), the outlier is flagged. This can indicate:
- An external contributor using a personal email
- A compromised account from a different organization
- A misconfigured git identity

### 3. Name/Email Mismatch
When the author's display name does not appear in any form within their email address, it is flagged. Normal contributors typically have their name in their email (e.g., `alice@example.com` for Alice, `bob-smith@dev.com` for Bob Smith). A complete mismatch suggests:
- A generic or shared account
- Identity obfuscation
- Automated commit generation with fake names

## Detection Prompt Template

```
Analyze the following author profile for potential identity anomalies.

Author: {name} <{email}>
Commit Count: {commitCount}
First Seen: {firstSeen}
Last Seen: {lastSeen}
Total Insertions: {insertions}
Total Deletions: {deletions}

Community Context:
- Total authors in repository: {totalAuthors}
- Dominant email domain: {dominantDomain}
- Average commits per author: {avgCommits}

Anomaly flags already triggered by automated checks:
{anomalyFlags}

Evaluate whether this author profile is suspicious and what additional investigation
should be performed. Consider:
1. Is the commit pattern consistent with a legitimate contributor?
2. Does the email domain mismatch indicate a concern?
3. Is the name/email discrepancy explainable?
4. Should this author's contributions be manually reviewed?

Rate the risk on a scale of 0.0 to 1.0 and explain your reasoning.
```
