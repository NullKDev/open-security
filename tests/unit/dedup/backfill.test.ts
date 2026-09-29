/**
 * tests/unit/dedup/backfill.test.ts
 *
 * Tests for the dedup backfill utility.
 * Verifies that existing findings with sentinel dedup_key get proper keys assigned,
 * canonical linking is performed, and the sentinel is skipped on subsequent boots.
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { runDedupeBackfill } from '@/lib/dedup/backfill'
import { computeDedupKey } from '@/lib/dedup/dedup-key'

function makeDb() {
  const sqlite = new Database(':memory:')
  return createTestDb(sqlite)
}

function insertRawFinding(
  db: ReturnType<typeof makeDb>,
  scanId: string,
  overrides: { title?: string; locationPath?: string; detector?: string; dedupKey?: string } = {},
) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  db.$client
    .prepare(`
      INSERT INTO findings (
        id, scan_id, detector, severity, confidence, exploitability,
        title, description, location_path, location_line_start,
        dedup_key, occurrence_count, first_detected_at, last_seen_at, created_at
      ) VALUES (
        ?, ?, ?, 'high', 0.8, 0.5,
        ?, 'desc', ?, 1,
        ?, 1, ?, ?, ?
      )
    `)
    .run(
      id,
      scanId,
      overrides.detector ?? 'semgrep',
      overrides.title ?? 'SQL Injection',
      overrides.locationPath ?? 'src/db.ts',
      overrides.dedupKey ?? '__pending_backfill__',
      now,
      now,
      now,
    )
  return id
}

describe('runDedupeBackfill', () => {
  it('assigns dedup keys to findings with sentinel value', () => {
    const db = makeDb()
    const project = createProject(db, { name: 'p', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    const id = insertRawFinding(db, scan.id, {
      title: 'SQL Injection',
      locationPath: 'src/db.ts',
      detector: 'semgrep',
      dedupKey: '__pending_backfill__',
    })

    runDedupeBackfill(db)

    const row = db.$client
      .prepare('SELECT dedup_key FROM findings WHERE id = ?')
      .get(id) as { dedup_key: string }

    const expected = computeDedupKey('semgrep', 'src/db.ts', 'SQL Injection')
    expect(row.dedup_key).toBe(expected)
  })

  it('sets first finding as canonical (canonical_finding_id IS NULL)', () => {
    const db = makeDb()
    const project = createProject(db, { name: 'p2', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    insertRawFinding(db, scan.id, { dedupKey: '__pending_backfill__' })

    runDedupeBackfill(db)

    const row = db.$client
      .prepare('SELECT canonical_finding_id FROM findings')
      .get() as { canonical_finding_id: string | null }

    expect(row.canonical_finding_id).toBeNull()
  })

  it('links duplicate findings to the canonical (oldest by created_at)', () => {
    const db = makeDb()
    const project = createProject(db, { name: 'p3', sourceKind: 'local', sourceRef: '/tmp' })
    const scan1 = createScan(db, { projectId: project.id })
    const scan2 = createScan(db, { projectId: project.id })

    // Insert two findings with same logical key, different times
    const idA = crypto.randomUUID()
    const idB = crypto.randomUUID()
    const earlier = '2024-01-01T00:00:00.000Z'
    const later = '2024-06-01T00:00:00.000Z'

    db.$client
      .prepare(`
        INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
          title, description, location_path, location_line_start, dedup_key,
          occurrence_count, first_detected_at, last_seen_at, created_at)
        VALUES (?, ?, 'semgrep', 'high', 0.8, 0.5, 'XSS', 'desc', 'src/view.ts', 1,
          '__pending_backfill__', 1, ?, ?, ?)
      `)
      .run(idA, scan1.id, earlier, earlier, earlier)

    db.$client
      .prepare(`
        INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
          title, description, location_path, location_line_start, dedup_key,
          occurrence_count, first_detected_at, last_seen_at, created_at)
        VALUES (?, ?, 'semgrep', 'high', 0.8, 0.5, 'XSS', 'desc', 'src/view.ts', 1,
          '__pending_backfill__', 1, ?, ?, ?)
      `)
      .run(idB, scan2.id, later, later, later)

    runDedupeBackfill(db)

    const rowA = db.$client
      .prepare('SELECT canonical_finding_id FROM findings WHERE id = ?')
      .get(idA) as { canonical_finding_id: string | null }
    const rowB = db.$client
      .prepare('SELECT canonical_finding_id FROM findings WHERE id = ?')
      .get(idB) as { canonical_finding_id: string | null }

    // Oldest (A) is canonical
    expect(rowA.canonical_finding_id).toBeNull()
    // Newer (B) is linked to A
    expect(rowB.canonical_finding_id).toBe(idA)
  })

  it('sets dedup_backfill_done sentinel in config table after completion', () => {
    const db = makeDb()
    runDedupeBackfill(db)

    const row = db.$client
      .prepare('SELECT value FROM config WHERE key = ?')
      .get('dedup_backfill_done') as { value: string } | undefined

    expect(row?.value).toBe('1')
  })

  it('skips backfill if sentinel already set in config', () => {
    const db = makeDb()
    const project = createProject(db, { name: 'p4', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    const id = insertRawFinding(db, scan.id, { dedupKey: '__pending_backfill__' })

    // Pre-set the sentinel
    db.$client.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('dedup_backfill_done', '1')").run()

    runDedupeBackfill(db)

    // Finding should still have sentinel key (backfill skipped)
    const row = db.$client
      .prepare('SELECT dedup_key FROM findings WHERE id = ?')
      .get(id) as { dedup_key: string }

    expect(row.dedup_key).toBe('__pending_backfill__')
  })

  it('does nothing when no findings have sentinel key', () => {
    const db = makeDb()
    // No findings at all
    runDedupeBackfill(db)

    const row = db.$client
      .prepare("SELECT value FROM config WHERE key = 'dedup_backfill_done'")
      .get() as { value: string } | undefined

    expect(row?.value).toBe('1')
  })

  it('processes findings in batches of 500 without error', () => {
    const db = makeDb()
    const project = createProject(db, { name: 'p5', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })

    // Insert 600 findings with sentinel
    const insert = db.$client.prepare(`
      INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
        title, description, location_path, location_line_start, dedup_key,
        occurrence_count, first_detected_at, last_seen_at, created_at)
      VALUES (?, ?, 'semgrep', 'high', 0.8, 0.5, ?, 'desc', ?, 1,
        '__pending_backfill__', 1, ?, ?, ?)
    `)

    for (let i = 0; i < 600; i++) {
      const now = new Date().toISOString()
      insert.run(
        crypto.randomUUID(),
        scan.id,
        `Finding ${i}`,
        `src/file${i}.ts`,
        now,
        now,
        now,
      )
    }

    // Should not throw
    expect(() => runDedupeBackfill(db)).not.toThrow()

    const remaining = db.$client
      .prepare("SELECT COUNT(*) as count FROM findings WHERE dedup_key = '__pending_backfill__'")
      .get() as { count: number }

    expect(remaining.count).toBe(0)
  })
})
