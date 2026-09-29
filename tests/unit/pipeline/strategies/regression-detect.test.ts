/**
 * tests/unit/pipeline/strategies/regression-detect.test.ts
 *
 * TDD: T-028 (RED) + T-028 GREEN — lib/dedup/post-hooks/regression-detect.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: runRegressionDetect(db, scanId)
 * - wraps detectAndMark from regressions.repo.ts
 * - returns count of regressions detected
 * - is idempotent (calling twice returns same total)
 * - fires notifyRegressionsBatch when regressions > 0
 * - does NOT fire notification when regressions = 0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { runRegressionDetect } from '@/lib/dedup/post-hooks/regression-detect'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(scanId: string, overrides: Partial<CreateFindingInput> = {}): CreateFindingInput {
  return {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: 'SQL Injection',
    locationPath: 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  }
}

function insertMergedBranch(sqlite: Database.Database, findingId: string, branchId: string): void {
  const mergedAt = new Date(Date.now() - 86400 * 1000).toISOString() // 1 day ago
  sqlite.prepare(
    `INSERT INTO finding_branches (id, finding_id, status, created_at, merged_at)
     VALUES (?, ?, 'created', ?, ?)`
  ).run(branchId, findingId, new Date().toISOString(), mergedAt)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runRegressionDetect', () => {
  let db: ReturnType<typeof createTestDb>
  let sqlite: Database.Database
  let projectId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp/r' })
    projectId = proj.id
    vi.stubGlobal('Notification', undefined)
  })

  it('returns 0 when no regressions are detected', () => {
    const scan = createScan(db, { projectId })
    insertFinding(db, makeInput(scan.id))

    const count = runRegressionDetect(db, scan.id)
    expect(count).toBe(0)
  })

  it('returns the number of regressions detected', () => {
    // Setup: original finding with merged branch
    const scan1 = createScan(db, { projectId })
    const orig = insertFinding(db, makeInput(scan1.id, { title: 'XSS Original' }))
    insertMergedBranch(sqlite, orig.id, 'branch-a')

    // New scan: same dedup_key reappears
    const scan2 = createScan(db, { projectId })
    const reg = insertFinding(db, makeInput(scan2.id, { title: 'XSS Regression' }))
    sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(orig.dedupKey, reg.id)

    const count = runRegressionDetect(db, scan2.id)
    expect(count).toBe(1)
  })

  it('is idempotent — calling twice for the same scan returns the same count', () => {
    const scan1 = createScan(db, { projectId })
    const orig = insertFinding(db, makeInput(scan1.id, { title: 'SSRF Original' }))
    insertMergedBranch(sqlite, orig.id, 'branch-b')

    const scan2 = createScan(db, { projectId })
    const reg = insertFinding(db, makeInput(scan2.id, { title: 'SSRF Regression' }))
    sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(orig.dedupKey, reg.id)

    const count1 = runRegressionDetect(db, scan2.id)
    const count2 = runRegressionDetect(db, scan2.id)

    expect(count1).toBe(1)
    expect(count2).toBe(1) // idempotent — same count returned
  })

  it('inserts notifications_dispatched row when regressions > 0', () => {
    const scan1 = createScan(db, { projectId })
    const orig = insertFinding(db, makeInput(scan1.id, { title: 'RCE Original' }))
    insertMergedBranch(sqlite, orig.id, 'branch-c')

    const scan2 = createScan(db, { projectId })
    const reg = insertFinding(db, makeInput(scan2.id, { title: 'RCE Regression' }))
    sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(orig.dedupKey, reg.id)

    runRegressionDetect(db, scan2.id)

    const row = sqlite.prepare(
      `SELECT COUNT(*) AS cnt FROM notifications_dispatched WHERE scan_id = ? AND kind = 'regression-batch'`
    ).get(scan2.id) as { cnt: number }

    expect(row.cnt).toBe(1)
  })

  it('does NOT insert notification row when count = 0', () => {
    const scan = createScan(db, { projectId })
    insertFinding(db, makeInput(scan.id))

    runRegressionDetect(db, scan.id)

    const row = sqlite.prepare(
      `SELECT COUNT(*) AS cnt FROM notifications_dispatched WHERE scan_id = ?`
    ).get(scan.id) as { cnt: number }

    expect(row.cnt).toBe(0)
  })
})
