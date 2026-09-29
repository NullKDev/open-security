/**
 * tests/unit/db/migration-v03-0011.test.ts
 *
 * TDD: T-002 — Migration 0011 (v0.3 ALTER existing tables)
 * Asserts new columns on findings and scan_events after applying migration 0011.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_FILES = [
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
]

const MIGRATIONS = MIGRATION_FILES.map((f) =>
  readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8'),
)

const MIGRATION_0011 = readFileSync(
  join(process.cwd(), 'drizzle', '0011_v03_alter_tables.sql'),
  'utf-8',
)

function stripBreakpoints(sql: string): string {
  return sql.replace(/--> statement-breakpoint/g, '')
}

function createBaseDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const sql of MIGRATIONS) {
    db.exec(stripBreakpoints(sql))
  }
  return db
}

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

describe('Migration 0011: v0.3 ALTER existing tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createBaseDb()
    db.exec(stripBreakpoints(MIGRATION_0011))
  })

  describe('findings table new columns', () => {
    it('verdict column added to findings', () => {
      const cols = getColumns(db, 'findings')
      expect(cols).toContain('verdict')
    })

    it('timeline_computed_at column added to findings', () => {
      const cols = getColumns(db, 'findings')
      expect(cols).toContain('timeline_computed_at')
    })

    it('verdict defaults to NULL', () => {
      db.pragma('foreign_keys = OFF')
      db.prepare(`
        INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('f-v03-1', 'scan-x', 'gitleaks', 'high', 0.9, 0.5, 'T', '', 'f.ts', 1, 0, new Date().toISOString())
      db.pragma('foreign_keys = ON')
      const row = db.prepare('SELECT verdict, timeline_computed_at FROM findings WHERE id = ?').get('f-v03-1') as any
      expect(row.verdict).toBeNull()
      expect(row.timeline_computed_at).toBeNull()
    })
  })

  describe('scan_events table new columns', () => {
    it('is_replay column added to scan_events', () => {
      const cols = getColumns(db, 'scan_events')
      expect(cols).toContain('is_replay')
    })

    it('injection_source column added to scan_events', () => {
      const cols = getColumns(db, 'scan_events')
      expect(cols).toContain('injection_source')
    })

    it('is_replay defaults to 0', () => {
      db.pragma('foreign_keys = OFF')
      db.prepare(`INSERT INTO scan_events (scan_id, type, payload, created_at) VALUES (?, ?, ?, ?)`).run(
        'scan-y', 'stage', '{}', new Date().toISOString(),
      )
      db.pragma('foreign_keys = ON')
      const row = db.prepare('SELECT is_replay, injection_source FROM scan_events WHERE scan_id = ?').get('scan-y') as any
      expect(row.is_replay).toBe(0)
      expect(row.injection_source).toBeNull()
    })
  })

  describe('applied once on fresh db', () => {
    it('migration can be applied to a clean base db without error', () => {
      // The beforeEach already applied it — if we got here without throwing, it works
      const cols = getColumns(db, 'findings')
      expect(cols).toContain('verdict')
      expect(cols).toContain('timeline_computed_at')
    })
  })
})
