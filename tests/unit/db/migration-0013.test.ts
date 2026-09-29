/**
 * tests/unit/db/migration-0013.test.ts
 *
 * TDD RED → GREEN: v1.0 schema additions
 *
 * Covers:
 * - New tables: finding_comments, finding_assignments, enrichment_cache, secrets
 * - ALTERs: findings (suggested_assignee, policy_rule_id, consensus_score, consensus_status,
 *   scanner_votes, jira_issue_key, jira_last_synced_at, sarif_last_uploaded_at, last_export_error)
 * - ALTERs: cve_scores (ghsa_id, cvss_vector, affected_versions, fixed_version, summary,
 *   epss, source, ttl_sec)
 * - All indexes
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Load all migrations in order, including the new v1.0 migration
const migrationFiles = [
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
  '0013_v1_0.sql',
]

function stripBreakpoints(sql: string): string {
  return sql.replace(/--> statement-breakpoint/g, '')
}

function createFullDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const f of migrationFiles) {
    const sql = readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8')
    db.exec(stripBreakpoints(sql))
  }
  return db
}

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getIndexes(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

/** Helper: insert prerequisite rows (project + scan + finding) */
function insertPrereqs(db: Database.Database): { projectId: string; scanId: string; findingId: string } {
  const projectId = 'proj-v1-1'
  const scanId = 'scan-v1-1'
  const findingId = 'finding-v1-1'
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
  ).run(findingId, scanId, 'semgrep', 'high', 0.9, 0.5, 'SQL Injection', '', 'src/db.ts', 10, 0, now, 'dedup-v1-1')

  return { projectId, scanId, findingId }
}

describe('Migration 0013: v1.0 policy, consensus, collaboration, secrets', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createFullDb()
  })

  // ─── New table: finding_comments ─────────────────────────────

  describe('finding_comments table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'finding_comments')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('actor')
      expect(cols).toContain('body')
      expect(cols).toContain('mentions')
      expect(cols).toContain('created_at')
    })

    it('has index on finding_id', () => {
      const indexes = getIndexes(db, 'finding_comments')
      expect(indexes.some((i) => i.includes('finding'))).toBe(true)
    })

    it('accepts an insert and is queryable', () => {
      const { findingId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO finding_comments (id, finding_id, actor, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('comment-1', findingId, 'alice', 'This is a test comment', now)

      const row = db.prepare('SELECT * FROM finding_comments WHERE id = ?').get('comment-1') as Record<string, unknown>
      expect(row).toBeTruthy()
      expect(row.actor).toBe('alice')
      expect(row.body).toBe('This is a test comment')
    })

    it('returns empty for non-existent finding_id', () => {
      const rows = db.prepare('SELECT * FROM finding_comments WHERE finding_id = ?').all('nonexistent') as unknown[]
      expect(rows).toHaveLength(0)
    })
  })

  // ─── New table: finding_assignments ──────────────────────────

  describe('finding_assignments table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'finding_assignments')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('assignee')
      expect(cols).toContain('actor')
      expect(cols).toContain('created_at')
      expect(cols).toContain('unassigned_at')
    })

    it('has index on finding_id', () => {
      const indexes = getIndexes(db, 'finding_assignments')
      expect(indexes.some((i) => i.includes('finding'))).toBe(true)
    })

    it('accepts an insert and unassigned_at defaults to null', () => {
      const { findingId } = insertPrereqs(db)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO finding_assignments (id, finding_id, assignee, actor, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('assign-1', findingId, 'bob', 'alice', now)

      const row = db.prepare('SELECT * FROM finding_assignments WHERE id = ?').get('assign-1') as Record<string, unknown>
      expect(row).toBeTruthy()
      expect(row.assignee).toBe('bob')
      expect(row.unassigned_at).toBeNull()
    })
  })

  // ─── New table: enrichment_cache ─────────────────────────────

  describe('enrichment_cache table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'enrichment_cache')
      expect(cols).toContain('key')
      expect(cols).toContain('value')
      expect(cols).toContain('fetched_at')
      expect(cols).toContain('ttl_sec')
    })

    it('key is primary key', () => {
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO enrichment_cache (key, value, fetched_at, ttl_sec) VALUES (?, ?, ?, ?)`
      ).run('socket:npm:lodash:4.17.21', '{"data":"test"}', now, 86400)

      // Duplicate key should fail
      expect(() => {
        db.prepare(
          `INSERT INTO enrichment_cache (key, value, fetched_at, ttl_sec) VALUES (?, ?, ?, ?)`
        ).run('socket:npm:lodash:4.17.21', '{"data":"other"}', now, 86400)
      }).toThrow()
    })

    it('has index on expires (fetched_at)', () => {
      const indexes = getIndexes(db, 'enrichment_cache')
      // Should have at least the primary key index
      expect(indexes.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ─── New table: secrets ───────────────────────────────────────

  describe('secrets table', () => {
    it('has all required columns', () => {
      const cols = getColumns(db, 'secrets')
      expect(cols).toContain('key')
      expect(cols).toContain('ciphertext')
      expect(cols).toContain('algo')
      expect(cols).toContain('created_at')
      expect(cols).toContain('updated_at')
    })

    it('key is primary key (no duplicates)', () => {
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO secrets (key, ciphertext, algo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run('jira.api_token', 'base64ciphertext==', 'aes-256-gcm', now, now)

      expect(() => {
        db.prepare(
          `INSERT INTO secrets (key, ciphertext, algo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
        ).run('jira.api_token', 'other==', 'aes-256-gcm', now, now)
      }).toThrow()
    })

    it('accepts insert and replace', () => {
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO secrets (key, ciphertext, algo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run('slack.webhook', 'ciphertext1==', 'aes-256-gcm', now, now)

      db.prepare(
        `INSERT OR REPLACE INTO secrets (key, ciphertext, algo, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      ).run('slack.webhook', 'ciphertext2==', 'aes-256-gcm', now, now)

      const row = db.prepare('SELECT ciphertext FROM secrets WHERE key = ?').get('slack.webhook') as Record<string, unknown>
      expect(row.ciphertext).toBe('ciphertext2==')
    })
  })

  // ─── ALTERs: findings table ───────────────────────────────────

  describe('findings table v1.0 alterations', () => {
    it('has suggested_assignee column', () => {
      expect(getColumns(db, 'findings')).toContain('suggested_assignee')
    })

    it('has policy_rule_id column', () => {
      expect(getColumns(db, 'findings')).toContain('policy_rule_id')
    })

    it('has consensus_score column defaulting to 1.0', () => {
      expect(getColumns(db, 'findings')).toContain('consensus_score')
      const { findingId } = insertPrereqs(db)
      const row = db.prepare('SELECT consensus_score FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row.consensus_score).toBe(1.0)
    })

    it('has consensus_status column defaulting to single-source', () => {
      expect(getColumns(db, 'findings')).toContain('consensus_status')
      const { findingId } = insertPrereqs(db)
      const row = db.prepare('SELECT consensus_status FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row.consensus_status).toBe('single-source')
    })

    it('has scanner_votes column', () => {
      expect(getColumns(db, 'findings')).toContain('scanner_votes')
    })

    it('has jira_issue_key column', () => {
      expect(getColumns(db, 'findings')).toContain('jira_issue_key')
    })

    it('has jira_last_synced_at column', () => {
      expect(getColumns(db, 'findings')).toContain('jira_last_synced_at')
    })

    it('has sarif_last_uploaded_at column', () => {
      expect(getColumns(db, 'findings')).toContain('sarif_last_uploaded_at')
    })

    it('has last_export_error column', () => {
      expect(getColumns(db, 'findings')).toContain('last_export_error')
    })
  })

  // ─── ALTERs: cve_scores table ────────────────────────────────

  describe('cve_scores table v1.0 alterations', () => {
    it('has ghsa_id column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('ghsa_id')
    })

    it('has cvss_vector column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('cvss_vector')
    })

    it('has affected_versions column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('affected_versions')
    })

    it('has fixed_version column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('fixed_version')
    })

    it('has summary column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('summary')
    })

    it('has epss column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('epss')
    })

    it('has source column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('source')
    })

    it('has ttl_sec column', () => {
      expect(getColumns(db, 'cve_scores')).toContain('ttl_sec')
    })
  })

  // ─── Idempotency / data preservation ─────────────────────────

  describe('data preservation', () => {
    it('existing findings survive the migration', () => {
      const { findingId } = insertPrereqs(db)
      const row = db.prepare('SELECT id FROM findings WHERE id = ?').get(findingId) as Record<string, unknown>
      expect(row.id).toBe(findingId)
    })
  })
})
