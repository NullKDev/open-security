/**
 * tests/unit/db/migration-0008-fts5.test.ts
 *
 * TDD: T-A03 — Migration 0008 FTS5 virtual tables + triggers
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
].map((f) => readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8'))

const MIGRATION_0008 = readFileSync(join(process.cwd(), 'drizzle', '0008_v01_fts5.sql'), 'utf-8')

function stripBreakpoints(sql: string): string {
  return sql.replace(/--> statement-breakpoint/g, '')
}

function createFullDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const sql of MIGRATIONS) {
    db.exec(stripBreakpoints(sql))
  }
  return db
}

function insertProject(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO projects (id, name, source_kind, source_ref, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, 'proj', 'github', 'url', new Date().toISOString()
  )
}

function insertScan(db: Database.Database, id: string, projectId: string): void {
  db.prepare('INSERT INTO scans (id, project_id, status) VALUES (?, ?, ?)').run(id, projectId, 'done')
}

function insertFinding(db: Database.Database, id: string, scanId: string, title: string, description = '', locationPath = 'file.ts'): void {
  db.prepare(`INSERT INTO findings
    (id, scan_id, detector, severity, confidence, exploitability, title, description, location_path, location_line_start, fp_filtered, created_at, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, scanId, 'semgrep', 'high', 0.9, 0.5, title, description, locationPath, 1, 0, new Date().toISOString(), 'key-' + id
  )
}

function insertDismissal(db: Database.Database, id: string, findingId: string, reason: string): void {
  db.prepare(`INSERT INTO finding_dismissals (id, finding_id, dedup_key, fp_type, reason, dismissed_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, findingId, 'dkey-' + id, 'false_positive', reason, new Date().toISOString()
  )
}

describe('Migration 0008: FTS5 virtual tables and triggers', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createFullDb()
    db.exec(MIGRATION_0008)
  })

  describe('findings_fts', () => {
    it('FTS5 MATCH returns a finding by title keyword after insert', () => {
      insertProject(db, 'p1')
      insertScan(db, 's1', 'p1')
      insertFinding(db, 'f1', 's1', 'SQL injection in user login', 'Uses raw query')

      const rows = db.prepare(`
        SELECT fm.finding_id
        FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('injection') as Array<{ finding_id: string }>

      expect(rows.length).toBe(1)
      expect(rows[0].finding_id).toBe('f1')
    })

    it('FTS5 entry removed when finding is deleted', () => {
      insertProject(db, 'p2')
      insertScan(db, 's2', 'p2')
      insertFinding(db, 'f2', 's2', 'Path traversal vulnerability')

      // Confirm it's there
      const before = db.prepare(`
        SELECT fm.finding_id FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('traversal') as Array<{ finding_id: string }>
      expect(before.length).toBe(1)

      // Delete the finding
      db.prepare('DELETE FROM findings WHERE id = ?').run('f2')

      const after = db.prepare(`
        SELECT fm.finding_id FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('traversal') as Array<{ finding_id: string }>
      expect(after.length).toBe(0)
    })

    it('FTS5 reflects updated title after update trigger', () => {
      insertProject(db, 'p3')
      insertScan(db, 's3', 'p3')
      insertFinding(db, 'f3', 's3', 'Old vulnerability title')

      // Update title
      db.prepare("UPDATE findings SET title = 'New XSS vulnerability title' WHERE id = 'f3'").run()

      // Old term should be gone, new term present
      const oldResults = db.prepare(`
        SELECT fm.finding_id FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('Old') as Array<{ finding_id: string }>
      expect(oldResults.length).toBe(0)

      const newResults = db.prepare(`
        SELECT fm.finding_id FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('XSS') as Array<{ finding_id: string }>
      expect(newResults.length).toBe(1)
      expect(newResults[0].finding_id).toBe('f3')
    })

    it('multiple findings can be searched simultaneously', () => {
      insertProject(db, 'p4')
      insertScan(db, 's4', 'p4')
      insertFinding(db, 'f4a', 's4', 'SQL injection in login')
      insertFinding(db, 'f4b', 's4', 'SQL injection in signup')
      insertFinding(db, 'f4c', 's4', 'XSS in profile page')

      const rows = db.prepare(`
        SELECT fm.finding_id FROM findings_fts_map fm
        JOIN findings_fts fts ON fts.rowid = fm.rowid
        WHERE findings_fts MATCH ?
      `).all('SQL') as Array<{ finding_id: string }>

      const ids = rows.map((r) => r.finding_id)
      expect(ids).toContain('f4a')
      expect(ids).toContain('f4b')
      expect(ids).not.toContain('f4c')
    })
  })

  describe('fp_bank_fts', () => {
    it('FTS5 MATCH returns a dismissal by reason keyword', () => {
      insertProject(db, 'p5')
      insertScan(db, 's5', 'p5')
      insertFinding(db, 'f5', 's5', 'Path traversal in fixtures')
      insertDismissal(db, 'd5', 'f5', 'Path traversal in test fixtures only')

      const rows = db.prepare(`
        SELECT dm.dismissal_id FROM fp_bank_fts_map dm
        JOIN fp_bank_fts fts ON fts.rowid = dm.rowid
        WHERE fp_bank_fts MATCH ?
      `).all('fixtures') as Array<{ dismissal_id: string }>

      expect(rows.length).toBe(1)
      expect(rows[0].dismissal_id).toBe('d5')
    })

    it('FTS5 entry removed when dismissal is deleted', () => {
      insertProject(db, 'p6')
      insertScan(db, 's6', 'p6')
      insertFinding(db, 'f6', 's6', 'Auth bypass in admin panel')
      insertDismissal(db, 'd6', 'f6', 'This is only in the staging environment never production')

      const before = db.prepare(`
        SELECT dm.dismissal_id FROM fp_bank_fts_map dm
        JOIN fp_bank_fts fts ON fts.rowid = dm.rowid
        WHERE fp_bank_fts MATCH ?
      `).all('staging') as Array<{ dismissal_id: string }>
      expect(before.length).toBe(1)

      db.prepare('DELETE FROM finding_dismissals WHERE id = ?').run('d6')

      const after = db.prepare(`
        SELECT dm.dismissal_id FROM fp_bank_fts_map dm
        JOIN fp_bank_fts fts ON fts.rowid = dm.rowid
        WHERE fp_bank_fts MATCH ?
      `).all('staging') as Array<{ dismissal_id: string }>
      expect(after.length).toBe(0)
    })
  })
})
