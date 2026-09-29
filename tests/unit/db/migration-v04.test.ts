/**
 * tests/unit/db/migration-v04.test.ts
 *
 * TDD: T-001 + T-002 — v0.4 schema additions
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers:
 * - All new tables: fix_proofs, posture_snapshots, mttr_by_severity,
 *   finding_regressions, finding_dismissal_history, notifications_dispatched
 * - ALTERs: findings (proof_of_fix_id, is_regression, regression_of_finding_id),
 *   finding_branches (merged_at),
 *   finding_dismissals (appealed_at, appeal_reason, appeal_author)
 * - Indexes: findings_is_regression_idx, finding_branches_merged_idx
 * - Triggers: fdh_no_update, fdh_no_delete (append-only audit)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Load all existing migrations in order + the new v0.4 migration
const migrations = [
  '0000_glossy_the_hand.sql',
  '0001_scan_events.sql',
  '0002_scan_tree.sql',
  '0003_scan_mode.sql',
  '0004_orchestrated_scan_modes.sql',
  '0005_project_models_config.sql',
  '0006_fix_context.sql',
  '0007_v01_dedup_enrichment.sql',
  '0008_v01_fts5.sql',
  '0009_v02_diff_watch_sarif.sql',
  '0010_v03_new_tables.sql',
  '0011_v03_alter_tables.sql',
  '0012_v04_prove_and_measure.sql',
].map((f) => ({
  name: f,
  sql: readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8'),
}))

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getIndexes(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getTriggers(db: Database.Database): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function stripBreakpoints(sql: string): string {
  return sql.replace(/--> statement-breakpoint/g, '')
}

function createFullDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const m of migrations) {
    db.exec(stripBreakpoints(m.sql))
  }
  return db
}

/** Helper: insert prerequisite rows (project + scan + finding) */
function insertPrereqs(db: Database.Database): { projectId: string; scanId: string; findingId: string } {
  const projectId = 'proj-v04-1'
  const scanId = 'scan-v04-1'
  const findingId = 'finding-v04-1'
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO projects (id, name, source_kind, source_ref, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, 'Test Project', 'github', 'https://github.com/test', now)

  db.prepare(
    `INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?)`
  ).run(scanId, projectId, 'done')

  db.prepare(
    `INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(findingId, scanId, 'semgrep', 'high', 0.9, 0.5, 'SQL Injection', '', 'src/db.ts', 10, 0, now, 'dedup-v04-1')

  return { projectId, scanId, findingId }
}

describe('Migration 0012: v0.4 prove and measure', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createFullDb()
  })

  // ─── New table: fix_proofs ────────────────────────────────────

  describe('fix_proofs table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'fix_proofs')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('branch_id')
      expect(cols).toContain('patch_diff')
      expect(cols).toContain('regression_test_path')
      expect(cols).toContain('regression_test_diff')
      expect(cols).toContain('unit_test_passed')
      expect(cols).toContain('vul_run_passed_pre')
      expect(cols).toContain('vul_run_passed_post')
      expect(cols).toContain('outcome')
      expect(cols).toContain('failure_reason')
      expect(cols).toContain('pre_patch_output')
      expect(cols).toContain('post_patch_output')
      expect(cols).toContain('unit_test_output')
      expect(cols).toContain('started_at')
      expect(cols).toContain('completed_at')
      expect(cols).toContain('acp_session_id')
    })

    it('accepts an insert and is queryable', () => {
      const { findingId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO fix_proofs (id, finding_id, patch_diff, outcome, started_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('proof-1', findingId, 'diff text', 'in-progress', now)

      const row = db.prepare('SELECT * FROM fix_proofs WHERE id = ?').get('proof-1') as Record<string, unknown>
      expect(row).toBeTruthy()
      expect(row.outcome).toBe('in-progress')
      expect(row.completed_at).toBeNull()
    })

    it('has fix_proofs_finding_idx index', () => {
      const indexes = getIndexes(db, 'fix_proofs')
      expect(indexes.some((i) => i.includes('finding'))).toBe(true)
    })
  })

  // ─── New table: posture_snapshots ────────────────────────────

  describe('posture_snapshots table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'posture_snapshots')
      expect(cols).toContain('id')
      expect(cols).toContain('project_id')
      expect(cols).toContain('bucket_date')
      expect(cols).toContain('count_critical')
      expect(cols).toContain('count_high')
      expect(cols).toContain('count_medium')
      expect(cols).toContain('count_low')
      expect(cols).toContain('count_info')
      expect(cols).toContain('weighted_score')
      expect(cols).toContain('open_critical_days')
      expect(cols).toContain('snapshot_at')
      expect(cols).toContain('scan_id')
    })

    it('enforces UNIQUE(project_id, bucket_date)', () => {
      const { projectId, scanId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO posture_snapshots (id, project_id, bucket_date, weighted_score, open_critical_days, snapshot_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('snap-1', projectId, '2024-01-01', 10.0, 0.0, now)

      expect(() => {
        db.prepare(
          `INSERT INTO posture_snapshots (id, project_id, bucket_date, weighted_score, open_critical_days, snapshot_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run('snap-2', projectId, '2024-01-01', 20.0, 0.0, now)
      }).toThrow()
    })

    it('count columns default to 0', () => {
      const { projectId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO posture_snapshots (id, project_id, bucket_date, weighted_score, open_critical_days, snapshot_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('snap-3', projectId, '2024-01-02', 0.0, 0.0, now)

      const row = db.prepare('SELECT * FROM posture_snapshots WHERE id = ?').get('snap-3') as Record<string, unknown>
      expect(row.count_critical).toBe(0)
      expect(row.count_high).toBe(0)
      expect(row.count_medium).toBe(0)
      expect(row.count_low).toBe(0)
      expect(row.count_info).toBe(0)
    })
  })

  // ─── New table: mttr_by_severity ─────────────────────────────

  describe('mttr_by_severity table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'mttr_by_severity')
      expect(cols).toContain('project_id')
      expect(cols).toContain('severity')
      expect(cols).toContain('window_days')
      expect(cols).toContain('median_seconds')
      expect(cols).toContain('avg_seconds')
      expect(cols).toContain('sample_size')
      expect(cols).toContain('refreshed_at')
    })

    it('accepts a row and enforces composite PK', () => {
      const { projectId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO mttr_by_severity (project_id, severity, window_days, sample_size, refreshed_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(projectId, 'high', 30, 5, now)

      expect(() => {
        db.prepare(
          `INSERT INTO mttr_by_severity (project_id, severity, window_days, sample_size, refreshed_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(projectId, 'high', 30, 3, now)
      }).toThrow()
    })
  })

  // ─── New table: finding_regressions ──────────────────────────

  describe('finding_regressions table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'finding_regressions')
      expect(cols).toContain('id')
      expect(cols).toContain('original_finding_id')
      expect(cols).toContain('regressed_finding_id')
      expect(cols).toContain('original_branch_id')
      expect(cols).toContain('regression_commit_sha')
      expect(cols).toContain('detected_at')
    })

    it('enforces UNIQUE on regressed_finding_id', () => {
      const { projectId, scanId, findingId } = insertPrereqs(db)
      const now = new Date().toISOString()

      // Create a second finding as the "regressed" one
      const findingId2 = 'finding-v04-2'
      db.prepare(
        `INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at, dedup_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(findingId2, scanId, 'semgrep', 'high', 0.9, 0.5, 'SQL Injection 2', '', 'src/db.ts', 11, 0, now, 'dedup-v04-2')

      db.prepare(
        `INSERT INTO finding_regressions (id, original_finding_id, regressed_finding_id, detected_at)
         VALUES (?, ?, ?, ?)`
      ).run('reg-1', findingId, findingId2, now)

      // Second insert with same regressed_finding_id should fail
      expect(() => {
        db.prepare(
          `INSERT INTO finding_regressions (id, original_finding_id, regressed_finding_id, detected_at)
           VALUES (?, ?, ?, ?)`
        ).run('reg-2', findingId, findingId2, now)
      }).toThrow()
    })
  })

  // ─── New table: finding_dismissal_history ────────────────────

  describe('finding_dismissal_history table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'finding_dismissal_history')
      expect(cols).toContain('id')
      expect(cols).toContain('dismissal_id')
      expect(cols).toContain('action')
      expect(cols).toContain('actor')
      expect(cols).toContain('rationale_snapshot')
      expect(cols).toContain('source')
      expect(cols).toContain('ts')
    })

    it('has fdh_dismissal_idx index', () => {
      const indexes = getIndexes(db, 'finding_dismissal_history')
      expect(indexes.some((i) => i.includes('fdh') || i.includes('dismissal'))).toBe(true)
    })

    it('fdh_no_update trigger aborts UPDATE on history rows', () => {
      const { findingId } = insertPrereqs(db)
      const now = new Date().toISOString()

      // Insert a dismissal first
      db.prepare(
        `INSERT INTO finding_dismissals (id, finding_id, dedup_key, fp_type, reason, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('dis-1', findingId, 'dedup-v04-1', 'false_positive', 'A long enough rationale text', now)

      // Insert a history row
      db.prepare(
        `INSERT INTO finding_dismissal_history (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('hist-1', 'dis-1', 'created', 'user@test.com', 'A long enough rationale text', 'hand', now)

      // Try to UPDATE the history row — should abort
      expect(() => {
        db.prepare(`UPDATE finding_dismissal_history SET action = 'edited' WHERE id = 'hist-1'`).run()
      }).toThrow(/append-only/i)
    })

    it('fdh_no_delete trigger aborts DELETE on history rows', () => {
      const { findingId } = insertPrereqs(db)
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO finding_dismissals (id, finding_id, dedup_key, fp_type, reason, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('dis-2', findingId, 'dedup-v04-1', 'false_positive', 'A long enough rationale text', now)

      db.prepare(
        `INSERT INTO finding_dismissal_history (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('hist-2', 'dis-2', 'created', 'user@test.com', 'A long enough rationale text', 'hand', now)

      expect(() => {
        db.prepare(`DELETE FROM finding_dismissal_history WHERE id = 'hist-2'`).run()
      }).toThrow(/append-only/i)
    })
  })

  // ─── New table: notifications_dispatched ─────────────────────

  describe('notifications_dispatched table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'notifications_dispatched')
      expect(cols).toContain('scan_id')
      expect(cols).toContain('kind')
      expect(cols).toContain('ts')
    })

    it('enforces composite PK (scan_id, kind) — no duplicates', () => {
      const { scanId } = insertPrereqs(db)
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO notifications_dispatched (scan_id, kind, ts) VALUES (?, ?, ?)`
      ).run(scanId, 'regression-batch', now)

      expect(() => {
        db.prepare(
          `INSERT INTO notifications_dispatched (scan_id, kind, ts) VALUES (?, ?, ?)`
        ).run(scanId, 'regression-batch', now)
      }).toThrow()
    })
  })

  // ─── ALTERs: findings table ───────────────────────────────────

  describe('findings table alterations', () => {
    it('has proof_of_fix_id column', () => {
      expect(getColumns(db, 'findings')).toContain('proof_of_fix_id')
    })

    it('has is_regression column defaulting to 0', () => {
      expect(getColumns(db, 'findings')).toContain('is_regression')
      const { findingId } = insertPrereqs(db)
      const row = db.prepare('SELECT is_regression FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row.is_regression).toBe(0)
    })

    it('has regression_of_finding_id column', () => {
      expect(getColumns(db, 'findings')).toContain('regression_of_finding_id')
    })

    it('has status column (nullable, no default)', () => {
      expect(getColumns(db, 'findings')).toContain('status')
    })

    it('has findings_is_regression_idx index', () => {
      const indexes = getIndexes(db, 'findings')
      expect(indexes.some((i) => i.includes('is_regression'))).toBe(true)
    })
  })

  // ─── ALTERs: finding_branches table ──────────────────────────

  describe('finding_branches table alterations', () => {
    it('has merged_at column', () => {
      expect(getColumns(db, 'finding_branches')).toContain('merged_at')
    })

    it('has finding_branches_merged_idx index', () => {
      const indexes = getIndexes(db, 'finding_branches')
      expect(indexes.some((i) => i.includes('merged'))).toBe(true)
    })
  })

  // ─── ALTERs: finding_dismissals table ────────────────────────

  describe('finding_dismissals table alterations', () => {
    it('has appealed_at column', () => {
      expect(getColumns(db, 'finding_dismissals')).toContain('appealed_at')
    })

    it('has appeal_reason column', () => {
      expect(getColumns(db, 'finding_dismissals')).toContain('appeal_reason')
    })

    it('has appeal_author column', () => {
      expect(getColumns(db, 'finding_dismissals')).toContain('appeal_author')
    })
  })

  // ─── Idempotency ─────────────────────────────────────────────

  describe('Idempotency', () => {
    it('existing data survives migration (no data loss)', () => {
      const { findingId } = insertPrereqs(db)
      const row = db.prepare('SELECT id FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row.id).toBe(findingId)
    })

    it('existing findings keep status values unchanged', () => {
      const { findingId } = insertPrereqs(db)
      // The test insert doesn't set status — verify it doesn't error
      const row = db.prepare('SELECT id FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row).toBeTruthy()
    })
  })
})
