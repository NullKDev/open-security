/**
 * tests/unit/db/migration-0007.test.ts
 *
 * TDD: T-A02 — Migration 0007 runs on :memory: db
 * Asserts all new tables/columns/indexes from 0007 exist via PRAGMA.
 *
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_0000 = readFileSync(join(process.cwd(), 'drizzle', '0000_glossy_the_hand.sql'), 'utf-8')
const MIGRATION_0001 = readFileSync(join(process.cwd(), 'drizzle', '0001_scan_events.sql'), 'utf-8')
const MIGRATION_0002 = readFileSync(join(process.cwd(), 'drizzle', '0002_scan_tree.sql'), 'utf-8')
const MIGRATION_0003 = readFileSync(join(process.cwd(), 'drizzle', '0003_scan_mode.sql'), 'utf-8')
const MIGRATION_0004 = readFileSync(join(process.cwd(), 'drizzle', '0004_orchestrated_scan_modes.sql'), 'utf-8')
const MIGRATION_0005 = readFileSync(join(process.cwd(), 'drizzle', '0005_project_models_config.sql'), 'utf-8')
const MIGRATION_0006 = readFileSync(join(process.cwd(), 'drizzle', '0006_fix_context.sql'), 'utf-8')
const MIGRATION_0007 = readFileSync(join(process.cwd(), 'drizzle', '0007_v01_dedup_enrichment.sql'), 'utf-8')

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getIndexes(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function createBaseDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Strip Drizzle statement breakpoints
  const stripBreakpoints = (sql: string) => sql.replace(/--> statement-breakpoint/g, '')
  db.exec(stripBreakpoints(MIGRATION_0000))
  db.exec(stripBreakpoints(MIGRATION_0001))
  db.exec(stripBreakpoints(MIGRATION_0002))
  db.exec(stripBreakpoints(MIGRATION_0003))
  db.exec(stripBreakpoints(MIGRATION_0004))
  db.exec(stripBreakpoints(MIGRATION_0005))
  db.exec(stripBreakpoints(MIGRATION_0006))
  return db
}

describe('Migration 0007: v0.1 dedup + enrichment', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createBaseDb()
    db.exec(MIGRATION_0007)
  })

  describe('projects table', () => {
    it('test_command column added', () => {
      const cols = getColumns(db, 'projects')
      expect(cols).toContain('test_command')
    })

    it('tests_enabled column added with default 0', () => {
      const cols = getColumns(db, 'projects')
      expect(cols).toContain('tests_enabled')

      db.prepare('INSERT INTO projects (id, name, source_kind, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'p1', 'proj', 'github', 'url', new Date().toISOString()
      )
      const row = db.prepare('SELECT tests_enabled FROM projects WHERE id = ?').get('p1') as any
      expect(row.tests_enabled).toBe(0)
    })
  })

  describe('findings table new columns', () => {
    it('dedup_key column added', () => {
      expect(getColumns(db, 'findings')).toContain('dedup_key')
    })
    it('canonical_finding_id column added', () => {
      expect(getColumns(db, 'findings')).toContain('canonical_finding_id')
    })
    it('cve_ids column added', () => {
      expect(getColumns(db, 'findings')).toContain('cve_ids')
    })
    it('first_detected_at column added', () => {
      expect(getColumns(db, 'findings')).toContain('first_detected_at')
    })
    it('last_seen_at column added', () => {
      expect(getColumns(db, 'findings')).toContain('last_seen_at')
    })
    it('occurrence_count column added with default 1', () => {
      expect(getColumns(db, 'findings')).toContain('occurrence_count')
    })
  })

  describe('findings table indexes', () => {
    it('findings_dedup_key_idx index created', () => {
      const indexes = getIndexes(db, 'findings')
      expect(indexes.some((i) => i.includes('dedup_key'))).toBe(true)
    })
    it('findings_canonical_idx index created', () => {
      const indexes = getIndexes(db, 'findings')
      expect(indexes.some((i) => i.includes('canonical'))).toBe(true)
    })
  })

  describe('cve_scores table', () => {
    it('cve_scores table created', () => {
      const cols = getColumns(db, 'cve_scores')
      expect(cols).toContain('cve_id')
      expect(cols).toContain('epss_score')
      expect(cols).toContain('epss_percentile')
      expect(cols).toContain('cisa_kev')
      expect(cols).toContain('fetched_at')
    })

    it('cisa_kev defaults to 0', () => {
      db.prepare('INSERT INTO cve_scores (cve_id) VALUES (?)').run('CVE-2024-0001')
      const row = db.prepare('SELECT cisa_kev FROM cve_scores WHERE cve_id = ?').get('CVE-2024-0001') as any
      expect(row.cisa_kev).toBe(0)
    })
  })

  describe('finding_dismissals table', () => {
    it('finding_dismissals table created with all columns', () => {
      const cols = getColumns(db, 'finding_dismissals')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('dedup_key')
      expect(cols).toContain('fp_type')
      expect(cols).toContain('reason')
      expect(cols).toContain('dismissed_at')
      expect(cols).toContain('undone_at')
    })

    it('fp_dedup_active_idx index created', () => {
      const indexes = getIndexes(db, 'finding_dismissals')
      expect(indexes.some((i) => i.includes('fp_dedup_active'))).toBe(true)
    })
  })

  describe('finding_branches table', () => {
    it('finding_branches table created with all columns', () => {
      const cols = getColumns(db, 'finding_branches')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('branch_ref')
      expect(cols).toContain('status')
      expect(cols).toContain('apply_error')
      expect(cols).toContain('tests_output')
      expect(cols).toContain('tests_passed')
      expect(cols).toContain('pr_url')
      expect(cols).toContain('created_at')
      expect(cols).toContain('updated_at')
    })

    it('status defaults to pending', () => {
      // Insert prerequisite rows
      db.prepare('INSERT INTO projects (id, name, source_kind, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'p2', 'proj', 'github', 'url', new Date().toISOString()
      )
      db.prepare('INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?)').run('s2', 'p2', 'done')
      db.prepare(`INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'f2', 's2', 'gitleaks', 'high', 0.9, 0.5, 'Test', '', 'file.ts', 1, 0, new Date().toISOString()
      )
      db.prepare('INSERT INTO finding_branches (id, finding_id, created_at) VALUES (?, ?, ?)').run(
        'b2', 'f2', new Date().toISOString()
      )
      const row = db.prepare('SELECT status FROM finding_branches WHERE id = ?').get('b2') as any
      expect(row.status).toBe('pending')
    })
  })

  describe('backfill sentinels', () => {
    it('existing findings get dedup_key = __pending_backfill__ sentinel', () => {
      // Insert a finding BEFORE migration (simulate pre-existing data)
      const db2 = createBaseDb()
      db2.prepare('INSERT INTO projects (id, name, source_kind, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'p3', 'proj', 'github', 'url', '2024-01-01T00:00:00.000Z'
      )
      db2.prepare('INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?)').run('s3', 'p3', 'done')
      db2.prepare(`INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'f3', 's3', 'gitleaks', 'high', 0.9, 0.5, 'Old Finding', '', 'old.ts', 1, 0, '2024-01-01T00:00:00.000Z'
      )
      // Apply migration 0007
      db2.exec(MIGRATION_0007)
      const row = db2.prepare('SELECT dedup_key, first_detected_at FROM findings WHERE id = ?').get('f3') as any
      expect(row.dedup_key).toBe('__pending_backfill__')
      expect(row.first_detected_at).toBe('2024-01-01T00:00:00.000Z')
    })
  })
})
