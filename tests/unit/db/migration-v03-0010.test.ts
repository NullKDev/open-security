/**
 * tests/unit/db/migration-v03-0010.test.ts
 *
 * TDD: T-001 — Migration 0010 (v0.3 new tables)
 * Asserts all 4 new tables exist after applying migration 0010.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = [
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
].map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8'))

const MIGRATION_0010 = readFileSync(
  join(process.cwd(), 'drizzle', '0010_v03_new_tables.sql'),
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

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined
  return row !== undefined
}

describe('Migration 0010: v0.3 new tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createBaseDb()
    db.exec(stripBreakpoints(MIGRATION_0010))
  })

  describe('hunt_targets table', () => {
    it('hunt_targets table is created', () => {
      expect(tableExists(db, 'hunt_targets')).toBe(true)
    })

    it('hunt_targets has all required columns', () => {
      const cols = getColumns(db, 'hunt_targets')
      expect(cols).toContain('id')
      expect(cols).toContain('scan_id')
      expect(cols).toContain('cve_id')
      expect(cols).toContain('target_path')
      expect(cols).toContain('advisory_raw')
      expect(cols).toContain('verdict')
      expect(cols).toContain('created_at')
    })

    it('hunt_targets created_at defaults to now', () => {
      // Insert a row without project/scan prerequisites (FK off in :memory: with FK pragma)
      // Since FK is ON, we need to disable it temporarily for this insert-only test
      db.pragma('foreign_keys = OFF')
      db.prepare(`INSERT INTO hunt_targets (id, scan_id, cve_id, target_path) VALUES (?, ?, ?, ?)`).run(
        'ht-1', 'scan-1', 'CVE-2024-0001', '/path/to/target',
      )
      db.pragma('foreign_keys = ON')
      const row = db.prepare(`SELECT created_at FROM hunt_targets WHERE id = ?`).get('ht-1') as any
      expect(row.created_at).toBeTruthy()
    })
  })

  describe('scan_forks table', () => {
    it('scan_forks table is created', () => {
      expect(tableExists(db, 'scan_forks')).toBe(true)
    })

    it('scan_forks has all required columns', () => {
      const cols = getColumns(db, 'scan_forks')
      expect(cols).toContain('id')
      expect(cols).toContain('parent_scan_id')
      expect(cols).toContain('child_scan_id')
      expect(cols).toContain('fork_event_id')
      expect(cols).toContain('created_at')
    })
  })

  describe('playbooks table', () => {
    it('playbooks table is created', () => {
      expect(tableExists(db, 'playbooks')).toBe(true)
    })

    it('playbooks has all required columns', () => {
      const cols = getColumns(db, 'playbooks')
      expect(cols).toContain('id')
      expect(cols).toContain('name')
      expect(cols).toContain('version')
      expect(cols).toContain('description')
      expect(cols).toContain('prompt_template')
      expect(cols).toContain('scanner_scope')
      expect(cols).toContain('parameters')
      expect(cols).toContain('source')
      expect(cols).toContain('built_in')
      expect(cols).toContain('trusted')
      expect(cols).toContain('created_at')
    })

    it('playbooks source defaults to user and built_in/trusted to 0', () => {
      db.prepare(`INSERT INTO playbooks (id, name, version, prompt_template) VALUES (?, ?, ?, ?)`).run(
        'pb-1', 'My Playbook', '1.0.0', 'Check for {{cveId}}',
      )
      const row = db.prepare(`SELECT source, built_in, trusted FROM playbooks WHERE id = ?`).get('pb-1') as any
      expect(row.source).toBe('user')
      expect(row.built_in).toBe(0)
      expect(row.trusted).toBe(0)
    })
  })

  describe('finding_timelines table', () => {
    it('finding_timelines table is created', () => {
      expect(tableExists(db, 'finding_timelines')).toBe(true)
    })

    it('finding_timelines has all required columns', () => {
      const cols = getColumns(db, 'finding_timelines')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('commits')
      expect(cols).toContain('suspected_deploys')
      expect(cols).toContain('partial')
      expect(cols).toContain('computed_at')
    })

    it('finding_timelines suspected_deploys and partial default to 0', () => {
      db.pragma('foreign_keys = OFF')
      db.prepare(`INSERT INTO finding_timelines (id, finding_id, commits) VALUES (?, ?, ?)`).run(
        'ft-1', 'finding-1', '[]',
      )
      db.pragma('foreign_keys = ON')
      const row = db.prepare(`SELECT suspected_deploys, partial FROM finding_timelines WHERE id = ?`).get('ft-1') as any
      expect(row.suspected_deploys).toBe(0)
      expect(row.partial).toBe(0)
    })
  })

  describe('idempotency', () => {
    it('migration is idempotent — re-applying does not throw', () => {
      expect(() => {
        db.exec(stripBreakpoints(MIGRATION_0010))
      }).not.toThrow()
    })
  })
})
