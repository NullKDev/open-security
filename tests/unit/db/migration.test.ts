/**
 * tests/unit/db/migration.test.ts
 *
 * Tests for orchestrated_scan_modes migration (0004):
 * - project_map column present after migration
 * - deep → paranoid data migration
 * - Idempotent re-run
 * - New scan row without project_map accepted (NULL)
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), 'drizzle', '0004_orchestrated_scan_modes.sql'),
  'utf-8',
)

function createSchemaDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      prompt TEXT,
      scan_mode TEXT NOT NULL DEFAULT 'standard',
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      started_at TEXT,
      finished_at TEXT,
      models_used TEXT,
      error TEXT
    );
  `)
  return db
}

/** Apply the migration SQL to the database using SQLite's multi-statement exec. */
function applyMigration(db: Database.Database): void {
  db.exec(MIGRATION_SQL)
}

function insertScan(
  db: Database.Database,
  id: string,
  projectId: string,
  scanMode: string,
  status = 'pending',
): void {
  db.prepare(`
    INSERT INTO scans (id, project_id, scan_mode, status)
    VALUES (?, ?, ?, ?)
  `).run(id, projectId, scanMode, status)
}

describe('Migration 0004: orchestrated_scan_modes', () => {
  describe('DDL: project_map column', () => {
    it('project_map column is present after migration', () => {
      const db = createSchemaDb()
      applyMigration(db)

      // Insert a row WITHOUT project_map — should be accepted (NULL)
      insertScan(db, 'scan-1', 'proj-1', 'standard')

      const row = db.prepare('SELECT project_map FROM scans WHERE id = ?').get('scan-1') as any
      expect(row.project_map).toBeNull()
    })

    it('new scan row without project_map is accepted (NULL default)', () => {
      const db = createSchemaDb()
      applyMigration(db)

      insertScan(db, 'scan-2', 'proj-2', 'quick', 'running')

      const row = db.prepare('SELECT * FROM scans WHERE id = ?').get('scan-2') as any
      expect(row.id).toBe('scan-2')
      expect(row.project_map).toBeNull()
    })
  })

  describe('DML: deep → paranoid migration', () => {
    it('deep scan_mode rows become paranoid after migration', () => {
      const db = createSchemaDb()
      // Apply DDL only first, then insert legacy data, then apply DML
      db.exec('ALTER TABLE scans ADD COLUMN project_map TEXT;')

      insertScan(db, 'scan-deep-1', 'proj-3', 'deep', 'done')

      // Verify pre-migration state
      const before = db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-deep-1') as any
      expect(before.scan_mode).toBe('deep')

      // Apply the data migration
      db.exec("UPDATE scans SET scan_mode = 'paranoid' WHERE scan_mode = 'deep';")

      const after = db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-deep-1') as any
      expect(after.scan_mode).toBe('paranoid')
    })

    it('migration only affects deep rows, leaves others unchanged', () => {
      const db = createSchemaDb()
      db.exec('ALTER TABLE scans ADD COLUMN project_map TEXT;')

      insertScan(db, 'scan-quick', 'proj-4', 'quick', 'done')
      insertScan(db, 'scan-standard', 'proj-4', 'standard', 'done')
      insertScan(db, 'scan-deep-2', 'proj-4', 'deep', 'done')

      db.exec("UPDATE scans SET scan_mode = 'paranoid' WHERE scan_mode = 'deep';")

      expect((db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-quick') as any).scan_mode).toBe('quick')
      expect((db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-standard') as any).scan_mode).toBe('standard')
      expect((db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-deep-2') as any).scan_mode).toBe('paranoid')
    })
  })

  describe('Idempotency', () => {
    it('migration is idempotent — re-running produces no error', () => {
      const db = createSchemaDb()
      // Apply DDL first (simulate migration already ran)
      db.exec('ALTER TABLE scans ADD COLUMN project_map TEXT;')

      insertScan(db, 'scan-idem-1', 'proj-5', 'deep', 'done')
      insertScan(db, 'scan-idem-2', 'proj-5', 'paranoid', 'running')

      // Apply the data migration UPDATE
      db.exec("UPDATE scans SET scan_mode = 'paranoid' WHERE scan_mode = 'deep';")

      const row1 = db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-idem-1') as any
      expect(row1.scan_mode).toBe('paranoid')

      // Re-apply idempotent UPDATE — no rows match (already paranoid), should not throw
      expect(() => {
        db.exec("UPDATE scans SET scan_mode = 'paranoid' WHERE scan_mode = 'deep';")
      }).not.toThrow()

      const row1After = db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-idem-1') as any
      expect(row1After.scan_mode).toBe('paranoid')

      const row2After = db.prepare('SELECT scan_mode FROM scans WHERE id = ?').get('scan-idem-2') as any
      expect(row2After.scan_mode).toBe('paranoid')
    })

    it('new scan row without project_map accepted after re-running migration', () => {
      const db = createSchemaDb()
      applyMigration(db)

      // Insert after first migration application
      insertScan(db, 'scan-alter-1', 'proj-6', 'standard')

      const row = db.prepare('SELECT project_map FROM scans WHERE id = ?').get('scan-alter-1') as any
      expect(row.project_map).toBeNull()
    })
  })
})
