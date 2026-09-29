/**
 * tests/unit/notifications/desktop.test.ts
 *
 * TDD: T-026 (RED) + T-027 (GREEN) — lib/notifications/desktop.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: notifyRegressionsBatch(db, scanId, count)
 * - fires exactly one notification per scan (INSERT OR IGNORE)
 * - idempotent on retry — second call is a no-op
 * - does NOT fire when count = 0
 * - records to notifications_dispatched table
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { notifyRegressionsBatch } from '@/lib/notifications/desktop'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countDispatchedRows(sqlite: Database.Database, scanId: string): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS cnt FROM notifications_dispatched WHERE scan_id = ? AND kind = 'regression-batch'`
  ).get(scanId) as { cnt: number }
  return row.cnt
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('notifyRegressionsBatch', () => {
  let db: ReturnType<typeof createTestDb>
  let sqlite: Database.Database
  let scanId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp/r' })
    const scan = createScan(db, { projectId: proj.id })
    scanId = scan.id

    // Suppress actual desktop notification API calls — we only test DB side
    vi.stubGlobal('Notification', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inserts a notifications_dispatched row on first call', () => {
    notifyRegressionsBatch(db, scanId, 3)

    expect(countDispatchedRows(sqlite, scanId)).toBe(1)
  })

  it('is idempotent — calling twice for the same scan leaves only one row', () => {
    notifyRegressionsBatch(db, scanId, 3)
    notifyRegressionsBatch(db, scanId, 3) // retry — must be no-op

    expect(countDispatchedRows(sqlite, scanId)).toBe(1)
  })

  it('does NOT insert a row when count = 0', () => {
    notifyRegressionsBatch(db, scanId, 0)

    expect(countDispatchedRows(sqlite, scanId)).toBe(0)
  })

  it('returns true when the notification fires for the first time', () => {
    const fired = notifyRegressionsBatch(db, scanId, 5)
    expect(fired).toBe(true)
  })

  it('returns false on subsequent calls for the same scan', () => {
    notifyRegressionsBatch(db, scanId, 5)
    const fired = notifyRegressionsBatch(db, scanId, 5)
    expect(fired).toBe(false)
  })

  it('allows notifications for different scans independently', () => {
    const proj2 = createProject(db, { name: 'p2', sourceKind: 'local', sourceRef: '/tmp/r2' })
    const scan2 = createScan(db, { projectId: proj2.id })

    notifyRegressionsBatch(db, scanId, 2)
    notifyRegressionsBatch(db, scan2.id, 1)

    expect(countDispatchedRows(sqlite, scanId)).toBe(1)
    expect(countDispatchedRows(sqlite, scan2.id)).toBe(1)
  })
})
