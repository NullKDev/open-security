import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

// ─── Projects ────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceRef: text('source_ref').notNull(),
  /** JSON snapshot of ObtConfig.models at project creation time */
  modelsConfig: text('models_config'),
  createdAt: text('created_at').notNull(),
  /** Shell command to run the project's test suite (opt-in, default OFF) */
  testCommand: text('test_command'),
  /** Whether to run tests after branch creation (0 = disabled, 1 = enabled) */
  testsEnabled: integer('tests_enabled').notNull().default(0),
})

// ─── Scans ───────────────────────────────────────────────────
export const scans = sqliteTable('scans', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  parentId: text('parent_id'),
  version: integer('version').notNull().default(1),
  prompt: text('prompt'),
  scanMode: text('scan_mode').notNull().default('standard'),
  status: text('status').notNull().default('pending'),
  stage: text('stage'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  modelsUsed: text('models_used'),
  error: text('error'),
  projectMap: text('project_map'),
  // ─── v0.2: diff scan strategy + metadata ────────────────────
  /** Scan strategy: standard | quick | intermediate | paranoid | diff */
  strategy: text('strategy').notNull().default('standard'),
  /** Base commit SHA (diff scans only) */
  baseSha: text('base_sha'),
  /** Head commit SHA (diff scans only) */
  headSha: text('head_sha'),
  /** GitHub PR number that triggered this diff scan */
  prNumber: integer('pr_number'),
  /** GitHub comment ID created by this scan (for idempotent updates) */
  prCommentId: text('pr_comment_id'),
  /** Status of PR comment creation: pending | posted | failed */
  prCommentStatus: text('pr_comment_status'),
})

// ─── Findings ────────────────────────────────────────────────
export const findings = sqliteTable(
  'findings',
  {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id),
    detector: text('detector').notNull(),
    severity: text('severity').notNull(),
    confidence: real('confidence').notNull(),
    exploitability: real('exploitability').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    locationPath: text('location_path').notNull(),
    locationLineStart: integer('location_line_start').notNull(),
    locationLineEnd: integer('location_line_end'),
    locationCommit: text('location_commit'),
    dataFlow: text('data_flow'),
    evidenceHistory: text('evidence_history'),
    patchDiff: text('patch_diff'),
    patchExplanation: text('patch_explanation'),
    /** Code snippet around the finding location (for on-demand patch generation) */
    patchContext: text('patch_context'),
    /** ISO timestamp of when the patch was last generated */
    patchGeneratedAt: text('patch_generated_at'),
    validationModel: text('validation_model'),
    validationPasses: integer('validation_passes', { mode: 'boolean' }),
    validationRationale: text('validation_rationale'),
    fpFiltered: integer('fp_filtered', { mode: 'boolean' }).notNull().default(false),
    tags: text('tags'),
    createdAt: text('created_at').notNull(),
    // ─── v0.1 dedup + enrichment ───────────────────────────────
    /** SHA-256 of normalize(detector|location_path|title). Computed on insert. */
    dedupKey: text('dedup_key'),
    /** FK to the first (canonical) finding with this dedup_key. NULL = this IS the canonical. */
    canonicalFindingId: text('canonical_finding_id'),
    /** JSON array of CVE IDs extracted from osv findings (e.g. ["CVE-2023-44487"]) */
    cveIds: text('cve_ids'),
    /** ISO timestamp of when this finding was first detected (set on canonical insert) */
    firstDetectedAt: text('first_detected_at'),
    /** ISO timestamp of the most recent scan that saw this finding */
    lastSeenAt: text('last_seen_at'),
    /** How many times this finding has been seen across scans (canonical row only) */
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    // ─── v0.3: hunt verdict + timeline ────────────────────────────
    /** CVE hunt verdict for this finding: exposed | not-exposed | indeterminate */
    verdict: text('verdict'),
    /** ISO timestamp of when the secret timeline was last computed */
    timelineComputedAt: text('timeline_computed_at'),
    // ─── v0.4: status enum + Fix & Prove + regression detection ───
    /**
     * Finding lifecycle status. Validated via findingStatusSchema (ADR-8).
     * Values: 'open' | 'fixed' | 'dismissed' | 'verified-fixed' | 'fix-unverified' | 'regression'
     * Pre-v0.4 rows may have NULL — treat as 'open'.
     */
    status: text('status'),
    /** FK to the latest fix_proofs row (denormalized for queue query performance) */
    proofOfFixId: text('proof_of_fix_id'),
    /** 1 if this finding was detected as a regression of a previously merged fix */
    isRegression: integer('is_regression').notNull().default(0),
    /** FK to the original finding that was supposedly fixed and regressed */
    regressionOfFindingId: text('regression_of_finding_id'),
    // ─── v1.0: policy + consensus + export columns ────────────────────────
    /** Suggested assignee from policy engine `assign` rules */
    suggestedAssignee: text('suggested_assignee'),
    /** ID of the policy rule that suppressed this finding */
    policyRuleId: text('policy_rule_id'),
    /** Fraction of scanners that agreed on this finding (0.0–1.0) */
    consensusScore: real('consensus_score').default(1.0),
    /** 'single-source' | 'agree' | 'conflicted' */
    consensusStatus: text('consensus_status').default('single-source'),
    /** JSON array of { detector, vote } objects */
    scannerVotes: text('scanner_votes'),
    /** Jira ticket key (e.g. 'SEC-123') — null until exported */
    jiraIssueKey: text('jira_issue_key'),
    /** ISO timestamp of last Jira sync */
    jiraLastSyncedAt: text('jira_last_synced_at'),
    /** ISO timestamp of last SARIF upload to GitHub Code Scanning */
    sarifLastUploadedAt: text('sarif_last_uploaded_at'),
    /** JSON { target, message, at } for the last export error */
    lastExportError: text('last_export_error'),
  },
  (table) => ({
    scanSeverityIdx: index('findings_scan_severity_idx').on(
      table.scanId,
      table.severity,
    ),
    scanFpIdx: index('findings_scan_fp_idx').on(table.scanId, table.fpFiltered),
    dedupKeyIdx: index('findings_dedup_key_idx').on(table.dedupKey),
    canonicalIdx: index('findings_canonical_idx').on(table.canonicalFindingId),
    canonicalSeverityIdx: index('findings_canonical_severity_idx').on(
      table.canonicalFindingId,
      table.severity,
    ),
    // v0.2: composite index for delta detection queries
    scanDedupIdx: index('findings_scan_dedup_idx').on(table.scanId, table.dedupKey),
    // v1.0: consensus queue ordering
    consensusIdx: index('findings_consensus_idx').on(table.consensusStatus, table.severity),
  }),
)

// ─── Commits (composite PK: sha + scanId) ────────────────────
export const commits = sqliteTable(
  'commits',
  {
    sha: text('sha').notNull(),
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id),
    authorEmail: text('author_email'),
    authorName: text('author_name'),
    authoredAt: text('authored_at'),
    message: text('message'),
    filesChanged: integer('files_changed'),
    insertions: integer('insertions'),
    deletions: integer('deletions'),
    riskScore: real('risk_score'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sha, table.scanId] }),
    scanAuthoredIdx: index('commits_scan_authored_idx').on(
      table.scanId,
      table.authoredAt,
    ),
  }),
)

// ─── Authors (composite PK: scanId + email) ──────────────────
export const authors = sqliteTable(
  'authors',
  {
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id),
    email: text('email').notNull(),
    name: text('name'),
    commitCount: integer('commit_count').notNull().default(0),
    firstSeen: text('first_seen'),
    lastSeen: text('last_seen'),
    anomalyFlags: text('anomaly_flags'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.scanId, table.email] }),
  }),
)

// ─── Reports ─────────────────────────────────────────────────
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  scanId: text('scan_id')
    .notNull()
    .references(() => scans.id),
  format: text('format').notNull(),
  path: text('path').notNull(),
  generatedAt: text('generated_at').notNull(),
})

// ─── Config ──────────────────────────────────────────────────
export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// ─── Scan Events (high-priority event log for replay after restart) ───────────
// Stores only: stage, finding, error, done.
// Progress and thinking events are intentionally excluded — too chatty.
export const scanEvents = sqliteTable(
  'scan_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
    // ─── v0.3: injection replay fields ────────────────────────────
    /** 1 if this event is being replayed after a fork or restart */
    isReplay: integer('is_replay').default(0),
    /** Which component injected this event (e.g. 'user-console' | 'playbook') */
    injectionSource: text('injection_source'),
  },
  (table) => ({
    scanEventsIdx: index('scan_events_scan_id_idx').on(table.scanId),
  }),
)

// ─── v0.1: CVE Scores (EPSS + CISA KEV cache) — extended in v1.0 ────────────
export const cveScores = sqliteTable(
  'cve_scores',
  {
    cveId: text('cve_id').primaryKey(),
    epssScore: real('epss_score'),
    epssPercentile: real('epss_percentile'),
    /** 0 = not in CISA KEV, 1 = in CISA KEV */
    cisaKev: integer('cisa_kev').notNull().default(0),
    fetchedAt: text('fetched_at'),
    // ─── v1.0: OSV enrichment extensions ──────────────────────────────────
    /** GHSA alias for this CVE (e.g. 'GHSA-xxxx-xxxx-xxxx') */
    ghsaId: text('ghsa_id'),
    /** CVSS vector string (e.g. 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H') */
    cvssVector: text('cvss_vector'),
    /** JSON array of affected version strings */
    affectedVersions: text('affected_versions'),
    /** First version that includes the fix */
    fixedVersion: text('fixed_version'),
    /** Short advisory summary from OSV */
    summary: text('summary'),
    /** EPSS score from OSV (supplements the v0.1 epss_score column) */
    epss: real('epss'),
    /** Data source: 'osv' | 'nvd' */
    source: text('source'),
    /** Cache TTL in seconds (default 86400 = 24h) */
    ttlSec: integer('ttl_sec'),
  },
  (table) => ({
    kevIdx: index('cve_scores_kev_idx').on(table.cisaKev),
    // v1.0: GHSA alias lookup
    ghsaIdx: index('cve_scores_ghsa_idx').on(table.ghsaId),
  }),
)

// ─── v0.1: Finding Dismissals (FP bank) ──────────────────────
export const findingDismissals = sqliteTable(
  'finding_dismissals',
  {
    id: text('id').primaryKey(),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id),
    dedupKey: text('dedup_key').notNull(),
    /** One of: false_positive | acceptable_risk | wont_fix | duplicate */
    fpType: text('fp_type').notNull(),
    /** Dismissal reason — minimum 10 characters (enforced at API boundary via Zod) */
    reason: text('reason').notNull(),
    dismissedAt: text('dismissed_at').notNull(),
    /** ISO timestamp when this dismissal was undone; NULL = still active */
    undoneAt: text('undone_at'),
  },
  (table) => ({
    /** Enables efficient lookup of active dismissals by dedup_key */
    fpDedupActiveIdx: index('fp_dedup_active_idx').on(table.dedupKey, table.undoneAt),
  }),
)

// ─── v0.2: Repos (per-repo watch + webhook config) ───────────────
export const repos = sqliteTable('repos', {
  id: text('id').primaryKey(),
  /** Optional FK to projects.id */
  projectId: text('project_id'),
  name: text('name').notNull(),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  /** 0 = watch disabled (default), 1 = watch enabled */
  watchEnabled: integer('watch_enabled').notNull().default(0),
  /** Cron expression for watch schedule; default every 6 hours */
  watchInterval: text('watch_interval').notNull().default('0 */6 * * *'),
  /** JSON array of channels: e.g. '["desktop","slack"]' */
  notifyChannels: text('notify_channels'),
  /** Minimum severity to trigger notification: critical|high|medium|low */
  notifySeverityFloor: text('notify_severity_floor').notNull().default('high'),
  /** Reference key for Slack webhook URL in encrypted config store */
  slackWebhookUrlRef: text('slack_webhook_url_ref'),
  /** Reference key for webhook secret in encrypted config store */
  webhookSecretRef: text('webhook_secret_ref'),
  /** smee.io channel URL or other webhook proxy */
  webhookProxyUrl: text('webhook_proxy_url'),
  createdAt: text('created_at').notNull(),
})

// ─── v0.2: Webhook Events (durable GitHub PR event queue) ────────
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    repoId: text('repo_id'),
    /** GitHub delivery UUID — unique per event to prevent duplicates */
    deliveryId: text('delivery_id').unique(),
    event: text('event'),
    action: text('action'),
    payload: text('payload').notNull(),
    /** pending | processed | failed */
    status: text('status').notNull().default('pending'),
    receivedAt: text('received_at').notNull(),
    processedAt: text('processed_at'),
    scanId: text('scan_id'),
    error: text('error'),
  },
  (table) => ({
    statusIdx: index('webhook_events_status_idx').on(table.status),
  }),
)

// ─── v0.2: Watch Locks (advisory lock per repo+branch) ───────────
export const watchLocks = sqliteTable('watch_locks', {
  repoId: text('repo_id').notNull(),
  branch: text('branch').notNull(),
  acquiredAt: text('acquired_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.repoId, table.branch] }),
}))

// ─── v0.2: Notification Log (Slack coalescer + audit) ────────────
export const notificationLog = sqliteTable(
  'notification_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    repoId: text('repo_id').notNull(),
    /** desktop | slack */
    channel: text('channel').notNull(),
    scanId: text('scan_id'),
    findingCount: integer('finding_count').notNull().default(0),
    sentAt: text('sent_at').notNull(),
  },
  (table) => ({
    repoChannelIdx: index('notification_log_repo_channel_idx').on(
      table.repoId,
      table.channel,
      table.sentAt,
    ),
  }),
)

// ─── v0.3: Hunt Targets (CVE hunt results per scan) ─────────────
export const huntTargets = sqliteTable('hunt_targets', {
  id: text('id').primaryKey(),
  scanId: text('scan_id')
    .notNull()
    .references(() => scans.id),
  cveId: text('cve_id').notNull(),
  targetPath: text('target_path').notNull(),
  advisoryRaw: text('advisory_raw'),
  /** Hunt verdict: exposed | not-exposed | indeterminate */
  verdict: text('verdict'),
  createdAt: text('created_at').notNull(),
})

// ─── v0.3: Scan Forks (fork relationship between scans) ──────────
export const scanForks = sqliteTable('scan_forks', {
  id: text('id').primaryKey(),
  parentScanId: text('parent_scan_id')
    .notNull()
    .references(() => scans.id),
  childScanId: text('child_scan_id')
    .notNull()
    .references(() => scans.id),
  forkEventId: text('fork_event_id'),
  createdAt: text('created_at').notNull(),
})

// ─── v0.3: Playbooks (user-defined and builtin prompt playbooks) ─
export const playbooks = sqliteTable('playbooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  description: text('description'),
  promptTemplate: text('prompt_template').notNull(),
  scannerScope: text('scanner_scope'),
  parameters: text('parameters'),
  /** Source: user | builtin */
  source: text('source').notNull().default('user'),
  builtIn: integer('built_in').notNull().default(0),
  trusted: integer('trusted').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// ─── v0.3: Finding Timelines (secret exposure timeline per finding)
export const findingTimelines = sqliteTable('finding_timelines', {
  id: text('id').primaryKey(),
  findingId: text('finding_id')
    .notNull()
    .unique()
    .references(() => findings.id),
  /** JSON-serialised CommitInfo[] */
  commits: text('commits').notNull(),
  suspectedDeploys: integer('suspected_deploys').notNull().default(0),
  partial: integer('partial').notNull().default(0),
  computedAt: text('computed_at'),
})

// ─── v0.1: Finding Branches (branch remediation state machine) ─
export const findingBranches = sqliteTable('finding_branches', {
  id: text('id').primaryKey(),
  findingId: text('finding_id')
    .notNull()
    .unique()
    .references(() => findings.id),
  branchRef: text('branch_ref'),
  /** State machine: pending → creating → apply_failed | tests_running → tests_failed | created */
  status: text('status').notNull().default('pending'),
  applyError: text('apply_error'),
  testsOutput: text('tests_output'),
  testsPassed: integer('tests_passed'),
  prUrl: text('pr_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  // ─── v0.4: regression detection ────────────────────────────────
  /** ISO timestamp when this branch's PR was merged; used by regression detector */
  mergedAt: text('merged_at'),
})

// ─── v0.4 — ADR-8: Finding status Zod enum ─────────────────────────────────
/**
 * Valid status values for findings.status.
 * Widens the pre-v0.4 values (open | fixed | dismissed) with three new states.
 * No DB-level CHECK — validated at the repository boundary (ADR-8).
 */
export const findingStatusSchema = z.enum([
  'open',
  'fixed',
  'dismissed',
  'verified-fixed',
  'fix-unverified',
  'regression',
])
export type FindingStatus = z.infer<typeof findingStatusSchema>

// ─── v0.4 — fix_proofs (ADR-3) ──────────────────────────────────────────────
/**
 * One row per Fix & Prove triad attempt for a finding.
 * Multiple attempts per finding are supported; findings.proof_of_fix_id
 * points to the latest row for fast queue queries.
 */
export const fixProofs = sqliteTable(
  'fix_proofs',
  {
    id: text('id').primaryKey(),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id),
    branchId: text('branch_id').references(() => findingBranches.id),
    // Inputs
    /** Snapshot of patch_diff at the time the triad ran (patch may change) */
    patchDiff: text('patch_diff').notNull(),
    /** Path to the regression test file authored by the agent (null until Turn 3) */
    regressionTestPath: text('regression_test_path'),
    /** Diff of the regression test file for PR dual-diff comment */
    regressionTestDiff: text('regression_test_diff'),
    // Triad signals
    /** Whether the project's test suite passed post-patch */
    unitTestPassed: integer('unit_test_passed', { mode: 'boolean' }),
    /** Whether the regression test FAILED on the pre-patch working tree */
    vulRunPassedPre: integer('vul_run_passed_pre', { mode: 'boolean' }),
    /** Whether the regression test PASSED on the post-patch working tree */
    vulRunPassedPost: integer('vul_run_passed_post', { mode: 'boolean' }),
    // Outcome
    /**
     * 'in-progress' | 'verified-fixed' | 'fix-unverified'
     * Set to 'in-progress' on insert; updated to final value when triad completes.
     */
    outcome: text('outcome').notNull(),
    /**
     * Reason for fix-unverified outcome.
     * One of: 'no-patch' | 'unit-test-baseline-red' | 'regression-test-invalid'
     *       | 'vul-not-eliminated' | 'unit-test-failed' | 'agent-error' | 'timeout'
     */
    failureReason: text('failure_reason'),
    // Captured terminal output (last ~2 KB each — sufficient for the PR comment)
    prePatchOutput: text('pre_patch_output'),
    postPatchOutput: text('post_patch_output'),
    unitTestOutput: text('unit_test_output'),
    // Lifecycle
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    /** ACP session ID for replay/correlation with scan_events */
    acpSessionId: text('acp_session_id'),
  },
  (t) => ({
    findingIdx: index('fix_proofs_finding_idx').on(t.findingId, t.completedAt),
  }),
)

// ─── v0.4 — posture_snapshots (ADR-4) ───────────────────────────────────────
/**
 * Pre-computed daily severity-weighted posture snapshot per project.
 * One row per (project_id, bucket_date) — UNIQUE enforced.
 * Refreshed at scan completion via lib/posture/refresh.ts::refreshPosture().
 */
export const postureSnapshots = sqliteTable(
  'posture_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** UTC date bucket in 'YYYY-MM-DD' format */
    bucketDate: text('bucket_date').notNull(),
    // Severity counts for this day's snapshot
    countCritical: integer('count_critical').notNull().default(0),
    countHigh: integer('count_high').notNull().default(0),
    countMedium: integer('count_medium').notNull().default(0),
    countLow: integer('count_low').notNull().default(0),
    countInfo: integer('count_info').notNull().default(0),
    /**
     * Severity-weighted score: critical×10 + high×5 + medium×2 + low×1 + info×0
     * (REQ-PT-01)
     */
    weightedScore: real('weighted_score').notNull(),
    /** Sum of (now() - created_at) over open critical findings not in finding_dismissals */
    openCriticalDays: real('open_critical_days').notNull().default(0),
    /** ISO timestamp when this snapshot was taken */
    snapshotAt: text('snapshot_at').notNull(),
    /** FK to the scan that triggered this snapshot refresh (nullable) */
    scanId: text('scan_id').references(() => scans.id),
  },
  (t) => ({
    projectDateUq: uniqueIndex('posture_proj_date_uq').on(t.projectId, t.bucketDate),
  }),
)

// ─── v0.4 — mttr_by_severity (ADR-4 + ADR-7) ───────────────────────────────
/**
 * Materialized MTTR (Mean Time To Remediate) per project × severity × window.
 * Treated as a regular table refreshed on scan completion and PR-merge events.
 * Median computed via row_number() window function (ADR-7).
 */
export const mttrBySeverity = sqliteTable(
  'mttr_by_severity',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    severity: text('severity').notNull(),
    /** Rolling window in days: 30 | 60 | 90 */
    windowDays: integer('window_days').notNull(),
    /** Median seconds to remediate; null when sample_size = 0 */
    medianSeconds: real('median_seconds'),
    avgSeconds: real('avg_seconds'),
    /** Number of remediated findings in this window (REQ-MT-04: < 5 = low confidence) */
    sampleSize: integer('sample_size').notNull(),
    /** ISO timestamp of last refresh */
    refreshedAt: text('refreshed_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.severity, t.windowDays] }),
  }),
)

// ─── v0.4 — finding_regressions (ADR-5) ─────────────────────────────────────
/**
 * Links a regression finding back to the original merged fix.
 * Inserted by lib/dedup/post-hooks/regression-detect.ts after dedup.
 * The NOT EXISTS guard in the detection SQL makes inserts idempotent.
 */
export const findingRegressions = sqliteTable(
  'finding_regressions',
  {
    id: text('id').primaryKey(),
    originalFindingId: text('original_finding_id')
      .notNull()
      .references(() => findings.id),
    regressedFindingId: text('regressed_finding_id')
      .notNull()
      .references(() => findings.id),
    originalBranchId: text('original_branch_id').references(() => findingBranches.id),
    regressionCommitSha: text('regression_commit_sha'),
    detectedAt: text('detected_at').notNull(),
  },
  (t) => ({
    regressedUq: uniqueIndex('finding_regressions_regressed_uq').on(t.regressedFindingId),
    originalIdx: index('finding_regressions_original_idx').on(t.originalFindingId),
  }),
)

// ─── v0.4 — finding_dismissal_history (ADR-6) ───────────────────────────────
/**
 * Immutable append-only audit log for finding dismissal lifecycle events.
 * Enforced by fdh_no_update and fdh_no_delete SQLite triggers.
 */
export const findingDismissalHistory = sqliteTable(
  'finding_dismissal_history',
  {
    id: text('id').primaryKey(),
    dismissalId: text('dismissal_id')
      .notNull()
      .references(() => findingDismissals.id),
    /**
     * Lifecycle action: 'created' | 'edited' | 'appealed' | 're-dismissed'
     */
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    /** Snapshot of the rationale at the moment of action */
    rationaleSnapshot: text('rationale_snapshot').notNull(),
    /** Source of the action: 'hand' | 'agent-assisted' */
    source: text('source').notNull(),
    ts: text('ts').notNull(),
  },
  (t) => ({
    dismissalIdx: index('fdh_dismissal_idx').on(t.dismissalId, t.ts),
  }),
)

// ─── v1.0 — finding_comments ────────────────────────────────────────────────
/**
 * User-authored text notes attached to findings.
 * Mentions are stored verbatim; notifications are deferred to v1.1.
 */
export const findingComments = sqliteTable(
  'finding_comments',
  {
    id: text('id').primaryKey(),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id),
    actor: text('actor').notNull(),
    body: text('body').notNull(),
    /** JSON array of @mention strings (stored as-is, no notification dispatch in v1.0) */
    mentions: text('mentions'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    findingCommentIdx: index('finding_comments_finding_idx').on(t.findingId, t.createdAt),
  }),
)

// ─── v1.0 — finding_assignments ─────────────────────────────────────────────
/**
 * Auditable assignment history for findings.
 * Current assignee = row where unassigned_at IS NULL.
 */
export const findingAssignments = sqliteTable(
  'finding_assignments',
  {
    id: text('id').primaryKey(),
    findingId: text('finding_id')
      .notNull()
      .references(() => findings.id),
    assignee: text('assignee').notNull(),
    actor: text('actor').notNull(),
    createdAt: text('created_at').notNull(),
    /** ISO timestamp when this assignment was superseded; NULL = currently active */
    unassignedAt: text('unassigned_at'),
  },
  (t) => ({
    findingAssignmentIdx: index('finding_assignments_finding_idx').on(t.findingId, t.unassignedAt),
  }),
)

// ─── v1.0 — enrichment_cache ─────────────────────────────────────────────────
/**
 * Generic KV+TTL cache for enrichment results (OSV, Socket).
 * Key format: '{source}:{ecosystem}:{pkg}:{version}' or 'cve:{cveId}'.
 */
export const enrichmentCache = sqliteTable(
  'enrichment_cache',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    ttlSec: integer('ttl_sec').notNull(),
  },
  (t) => ({
    expiresIdx: index('enrichment_cache_expires_idx').on(t.fetchedAt, t.ttlSec),
  }),
)

// ─── v1.0 — secrets ──────────────────────────────────────────────────────────
/**
 * AES-256-GCM encrypted credential store.
 * ciphertext = base64(iv ‖ authTag ‖ ciphertext_bytes).
 */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  /** base64-encoded (iv || authTag || ciphertext) */
  ciphertext: text('ciphertext').notNull(),
  algo: text('algo').notNull().default('aes-256-gcm'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ─── v0.4 — notifications_dispatched (ADR-5) ────────────────────────────────
/**
 * Idempotency table for per-scan desktop notifications (REQ-RT-06).
 * INSERT OR IGNORE pattern ensures exactly one notification fires per scan.
 */
export const notificationsDispatched = sqliteTable(
  'notifications_dispatched',
  {
    scanId: text('scan_id')
      .notNull()
      .references(() => scans.id),
    /** Notification kind: 'regression-batch' */
    kind: text('kind').notNull(),
    ts: text('ts').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scanId, t.kind] }),
  }),
)
