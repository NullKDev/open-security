/**
 * tests/unit/repos/regressions.test.ts
 *
 * TDD: T-007 (RED) + T-008 (GREEN) — regressions.repo.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: detectAndMark(scanId) — idempotent regression detection
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { detectAndMark } from '@/lib/repos/regressions.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

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

/** Raw SQL helper to set merged_at on a finding_branches row */
function setMergedAt(sqlite: Database.Database, branchId: string, mergedAt: string): void {
  sqlite.prepare(`UPDATE finding_branches SET merged_at = ? WHERE id = ?`).run(mergedAt, branchId)
}

/** Raw SQL helper to insert a finding_branches row */
function insertBranch(sqlite: Database.Database, findingId: string, branchId: string, mergedAt?: string): void {
  sqlite.prepare(
    `INSERT INTO finding_branches (id, finding_id, status, created_at, merged_at)
     VALUES (?, ?, 'created', ?, ?)`
  ).run(branchId, findingId, new Date().toISOString(), mergedAt ?? null)
}

describe('regressions.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let sqlite: Database.Database
  let projectId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    projectId = proj.id
  })

  describe('detectAndMark', () => {
    it('returns 0 when no findings in scan share a dedup_key with a merged branch', () => {
      const scan = createScan(db, { projectId })
      insertFinding(db, makeInput(scan.id))

      const count = detectAndMark(db, scan.id)
      expect(count).toBe(0)
    })

    it('detects a regression: new finding shares dedup_key with a previously merged finding', () => {
      // Scan 1: original finding gets merged
      const scan1 = createScan(db, { projectId })
      const originalFinding = insertFinding(db, makeInput(scan1.id, { title: 'SQL Injection Original' }))

      // Insert a branch and mark it merged
      const mergedAt = new Date(Date.now() - 86400 * 1000).toISOString() // 1 day ago
      insertBranch(sqlite, originalFinding.id, 'branch-orig-1', mergedAt)

      // Scan 2: same dedup_key reappears
      const scan2 = createScan(db, { projectId })
      const regressedFinding = insertFinding(db, makeInput(scan2.id, { title: 'SQL Injection Regression' }))

      // The dedup_key for both findings is the same (same detector+location+title normalization)
      // We need to manually ensure same dedup_key — use raw update
      sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(
        originalFinding.dedupKey, regressedFinding.id
      )

      const count = detectAndMark(db, scan2.id)
      expect(count).toBe(1)

      // Verify finding_regressions row inserted
      const regRow = sqlite.prepare(
        `SELECT * FROM finding_regressions WHERE regressed_finding_id = ?`
      ).get(regressedFinding.id) as Record<string, unknown> | undefined
      expect(regRow).toBeTruthy()
      expect(regRow!.original_finding_id).toBe(originalFinding.id)

      // Verify finding status set to 'regression' and is_regression = 1
      const findingRow = sqlite.prepare(`SELECT * FROM findings WHERE id = ?`).get(regressedFinding.id) as Record<string, unknown>
      expect(findingRow.is_regression).toBe(1)
      expect(findingRow.status).toBe('regression')
    })

    it('is idempotent — calling detectAndMark twice does not create duplicate rows', () => {
      const scan1 = createScan(db, { projectId })
      const originalFinding = insertFinding(db, makeInput(scan1.id, { title: 'XSS Original' }))
      const mergedAt = new Date(Date.now() - 86400 * 1000).toISOString()
      insertBranch(sqlite, originalFinding.id, 'branch-orig-2', mergedAt)

      const scan2 = createScan(db, { projectId })
      const regressedFinding = insertFinding(db, makeInput(scan2.id, { title: 'XSS Regression' }))
      sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(
        originalFinding.dedupKey, regressedFinding.id
      )

      detectAndMark(db, scan2.id)
      detectAndMark(db, scan2.id) // second call — must be no-op

      const rows = sqlite.prepare(
        `SELECT COUNT(*) AS cnt FROM finding_regressions WHERE regressed_finding_id = ?`
      ).get(regressedFinding.id) as { cnt: number }
      expect(rows.cnt).toBe(1)
    })

    it('does not mark a finding as regression if dedup_key has no merged branch', () => {
      const scan1 = createScan(db, { projectId })
      const originalFinding = insertFinding(db, makeInput(scan1.id, { title: 'SSRF Original' }))

      // Insert branch but WITHOUT merged_at (not yet merged)
      insertBranch(sqlite, originalFinding.id, 'branch-orig-3', undefined)

      const scan2 = createScan(db, { projectId })
      const finding2 = insertFinding(db, makeInput(scan2.id, { title: 'SSRF Same' }))
      sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(
        originalFinding.dedupKey, finding2.id
      )

      const count = detectAndMark(db, scan2.id)
      expect(count).toBe(0)
    })

    it('returns the correct count when multiple regressions detected in one scan', () => {
      const scan1 = createScan(db, { projectId })
      const mergedAt = new Date(Date.now() - 86400 * 1000).toISOString()

      const orig1 = insertFinding(db, makeInput(scan1.id, { title: 'Vuln A', detector: 'semgrep' }))
      insertBranch(sqlite, orig1.id, 'branch-a', mergedAt)

      const orig2 = insertFinding(db, makeInput(scan1.id, { title: 'Vuln B', detector: 'gitleaks', locationPath: 'src/auth.ts' }))
      insertBranch(sqlite, orig2.id, 'branch-b', mergedAt)

      const scan2 = createScan(db, { projectId })
      const reg1 = insertFinding(db, makeInput(scan2.id, { title: 'Vuln A Reg', detector: 'semgrep' }))
      const reg2 = insertFinding(db, makeInput(scan2.id, { title: 'Vuln B Reg', detector: 'gitleaks', locationPath: 'src/auth.ts' }))

      sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(orig1.dedupKey, reg1.id)
      sqlite.prepare(`UPDATE findings SET dedup_key = ? WHERE id = ?`).run(orig2.dedupKey, reg2.id)

      const count = detectAndMark(db, scan2.id)
      expect(count).toBe(2)
    })
  })
})
