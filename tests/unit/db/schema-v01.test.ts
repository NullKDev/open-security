/**
 * tests/unit/db/schema-v01.test.ts
 *
 * TDD: T-A01 — Assert new v0.1 columns present in Drizzle schema types
 * and that indexes compile without error on an in-memory DB.
 *
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getIndexes(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

describe('Schema v0.1 — new columns and tables', () => {
  let sqlite: Database.Database

  // We use createTestDb which runs all migrations including our new ones
  beforeEach(() => {
    sqlite = new Database(':memory:')
    createTestDb(sqlite)
  })

  describe('projects table additions', () => {
    it('has test_command column', () => {
      const cols = getColumns(sqlite, 'projects')
      expect(cols).toContain('test_command')
    })

    it('has tests_enabled column', () => {
      const cols = getColumns(sqlite, 'projects')
      expect(cols).toContain('tests_enabled')
    })
  })

  describe('findings table additions', () => {
    it('has dedup_key column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('dedup_key')
    })

    it('has canonical_finding_id column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('canonical_finding_id')
    })

    it('has cve_ids column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('cve_ids')
    })

    it('has first_detected_at column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('first_detected_at')
    })

    it('has last_seen_at column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('last_seen_at')
    })

    it('has occurrence_count column', () => {
      const cols = getColumns(sqlite, 'findings')
      expect(cols).toContain('occurrence_count')
    })

    it('has dedup_key index', () => {
      const indexes = getIndexes(sqlite, 'findings')
      expect(indexes.some((i) => i.includes('dedup_key'))).toBe(true)
    })

    it('has canonical_finding_id index', () => {
      const indexes = getIndexes(sqlite, 'findings')
      expect(indexes.some((i) => i.includes('canonical'))).toBe(true)
    })
  })

  describe('cve_scores table', () => {
    it('cve_scores table exists', () => {
      const cols = getColumns(sqlite, 'cve_scores')
      expect(cols.length).toBeGreaterThan(0)
    })

    it('has all required cve_scores columns', () => {
      const cols = getColumns(sqlite, 'cve_scores')
      expect(cols).toContain('cve_id')
      expect(cols).toContain('epss_score')
      expect(cols).toContain('epss_percentile')
      expect(cols).toContain('cisa_kev')
      expect(cols).toContain('fetched_at')
    })
  })

  describe('finding_dismissals table', () => {
    it('finding_dismissals table exists', () => {
      const cols = getColumns(sqlite, 'finding_dismissals')
      expect(cols.length).toBeGreaterThan(0)
    })

    it('has all required finding_dismissals columns', () => {
      const cols = getColumns(sqlite, 'finding_dismissals')
      expect(cols).toContain('id')
      expect(cols).toContain('finding_id')
      expect(cols).toContain('dedup_key')
      expect(cols).toContain('fp_type')
      expect(cols).toContain('reason')
      expect(cols).toContain('dismissed_at')
      expect(cols).toContain('undone_at')
    })

    it('has active dismissal index (dedup_key + undone_at)', () => {
      const indexes = getIndexes(sqlite, 'finding_dismissals')
      expect(indexes.some((i) => i.includes('fp_dedup_active'))).toBe(true)
    })
  })

  describe('finding_branches table', () => {
    it('finding_branches table exists', () => {
      const cols = getColumns(sqlite, 'finding_branches')
      expect(cols.length).toBeGreaterThan(0)
    })

    it('has all required finding_branches columns', () => {
      const cols = getColumns(sqlite, 'finding_branches')
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
  })
})
