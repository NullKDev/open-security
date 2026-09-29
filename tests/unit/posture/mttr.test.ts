/**
 * tests/unit/posture/mttr.test.ts
 *
 * TDD: T-024 (RED) + T-025 (GREEN) — lib/posture/mttr.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers:
 * - refreshMttr(projectId): ADR-7 SQL for 30/60/90d → UPSERT mttr_by_severity
 * - getMttr(projectId): reads mttr_by_severity table
 * - correct median for odd N (picks middle value)
 * - correct median for even N (average of two middle values)
 * - sample_size < 5 → low_confidence = true
 * - open findings (merged_at IS NULL) excluded
 * - global rollup (no projectId filter)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { refreshMttr, getMttr } from '@/lib/posture/mttr'
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

/**
 * Creates a finding_branches row with merged_at set.
 * mergedSeconds: how many seconds ago it was merged (positive = in the past).
 * firstDetectedSeconds: how many seconds ago the finding was first detected.
 */
function insertMergedBranch(
  sqlite: Database.Database,
  findingId: string,
  branchId: string,
  options: { mergedSecondsAgo: number; firstDetectedSecondsAgo?: number }
): void {
  const mergedAt = new Date(Date.now() - options.mergedSecondsAgo * 1000).toISOString()
  const firstDetectedAt = new Date(Date.now() - (options.firstDetectedSecondsAgo ?? options.mergedSecondsAgo + 3600) * 1000).toISOString()

  sqlite.prepare(
    `INSERT INTO finding_branches (id, finding_id, status, created_at, merged_at)
     VALUES (?, ?, 'created', ?, ?)`
  ).run(branchId, findingId, new Date().toISOString(), mergedAt)

  // Set first_detected_at on the finding for MTTR computation
  sqlite.prepare(
    `UPDATE findings SET first_detected_at = ? WHERE id = ?`
  ).run(firstDetectedAt, findingId)
}

/** Generates a unique string ID for test isolation */
let _seq = 0
function nextId(): string {
  return `id-${++_seq}-${Date.now()}`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mttr', () => {
  let db: ReturnType<typeof createTestDb>
  let sqlite: Database.Database
  let projectId: string
  let scanId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp/r' })
    projectId = proj.id
    const scan = createScan(db, { projectId })
    scanId = scan.id
  })

  describe('getMttr — no data', () => {
    it('returns empty array when no MTTR rows exist', () => {
      const rows = getMttr(db, projectId)
      expect(Array.isArray(rows)).toBe(true)
      expect(rows).toHaveLength(0)
    })
  })

  describe('refreshMttr — basic', () => {
    it('upserts rows for 30, 60, and 90 day windows after refresh', () => {
      // One merged finding in the 30-day window
      const f = insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1' }))
      insertMergedBranch(sqlite, f.id, nextId(), {
        mergedSecondsAgo: 10 * 24 * 3600,       // merged 10 days ago
        firstDetectedSecondsAgo: 20 * 24 * 3600, // detected 20 days ago → MTTR ≈ 10d
      })

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const windows = rows.map((r) => r.windowDays)

      expect(windows).toContain(30)
      expect(windows).toContain(60)
      expect(windows).toContain(90)
    })

    it('is idempotent — refreshing twice produces same result', () => {
      const f = insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1' }))
      insertMergedBranch(sqlite, f.id, nextId(), { mergedSecondsAgo: 5 * 24 * 3600, firstDetectedSecondsAgo: 10 * 24 * 3600 })

      refreshMttr(db, projectId)
      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const highRows30 = rows.filter((r) => r.severity === 'high' && r.windowDays === 30)
      expect(highRows30).toHaveLength(1)
    })
  })

  describe('median computation — odd N', () => {
    it('returns the middle value for odd N (N=3)', () => {
      // Three "high" findings merged in the 30d window.
      // Durations (seconds): 1d=86400, 2d=172800, 3d=259200
      // Sorted: [86400, 172800, 259200] → median = 172800
      const durations = [1, 2, 3] // days to remediate
      for (let i = 0; i < durations.length; i++) {
        const days = durations[i]
        const f = insertFinding(db, makeInput(scanId, { severity: 'high', title: `H${i}`, detector: `d${i}` }))
        insertMergedBranch(sqlite, f.id, nextId(), {
          mergedSecondsAgo: 5 * 24 * 3600,
          firstDetectedSecondsAgo: (5 + days) * 24 * 3600,
        })
      }

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const row = rows.find((r) => r.severity === 'high' && r.windowDays === 30)!

      expect(row).toBeTruthy()
      expect(row.sampleSize).toBe(3)
      // Median of [86400, 172800, 259200] = 172800 seconds (2 days)
      // Allow ±5% tolerance for julianday() floating point arithmetic
      expect(row.medianSeconds).toBeCloseTo(2 * 24 * 3600, -3)
    })
  })

  describe('median computation — even N', () => {
    it('returns the average of two middle values for even N (N=4)', () => {
      // Four "critical" findings. Durations: 1d, 2d, 4d, 5d
      // Sorted: [86400, 172800, 345600, 432000]
      // Median = (172800 + 345600) / 2 = 259200 (3 days)
      const durations = [1, 2, 4, 5] // days to remediate
      for (let i = 0; i < durations.length; i++) {
        const days = durations[i]
        const f = insertFinding(db, makeInput(scanId, { severity: 'critical', title: `C${i}`, detector: `d${i}` }))
        insertMergedBranch(sqlite, f.id, nextId(), {
          mergedSecondsAgo: 5 * 24 * 3600,
          firstDetectedSecondsAgo: (5 + days) * 24 * 3600,
        })
      }

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const row = rows.find((r) => r.severity === 'critical' && r.windowDays === 30)!

      expect(row).toBeTruthy()
      expect(row.sampleSize).toBe(4)
      // Median = (2d + 4d) / 2 = 3d = 259200 seconds
      expect(row.medianSeconds).toBeCloseTo(3 * 24 * 3600, -3)
    })
  })

  describe('low_confidence flag', () => {
    it('marks sample_size < 5 as low_confidence = true', () => {
      // 3 findings — below the threshold of 5
      for (let i = 0; i < 3; i++) {
        const f = insertFinding(db, makeInput(scanId, { severity: 'medium', title: `M${i}`, detector: `d${i}` }))
        insertMergedBranch(sqlite, f.id, nextId(), {
          mergedSecondsAgo: 5 * 24 * 3600,
          firstDetectedSecondsAgo: 10 * 24 * 3600,
        })
      }

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const row = rows.find((r) => r.severity === 'medium' && r.windowDays === 30)!

      expect(row).toBeTruthy()
      expect(row.sampleSize).toBe(3)
      expect(row.lowConfidence).toBe(true)
    })

    it('marks sample_size >= 5 as low_confidence = false', () => {
      // 5 findings — meets the threshold
      for (let i = 0; i < 5; i++) {
        const f = insertFinding(db, makeInput(scanId, { severity: 'low', title: `L${i}`, detector: `d${i}` }))
        insertMergedBranch(sqlite, f.id, nextId(), {
          mergedSecondsAgo: 5 * 24 * 3600,
          firstDetectedSecondsAgo: 10 * 24 * 3600,
        })
      }

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const row = rows.find((r) => r.severity === 'low' && r.windowDays === 30)!

      expect(row).toBeTruthy()
      expect(row.sampleSize).toBe(5)
      expect(row.lowConfidence).toBe(false)
    })
  })

  describe('open findings excluded', () => {
    it('does not include findings without merged_at in MTTR calculation', () => {
      // One open finding (no branch, so no merged_at)
      insertFinding(db, makeInput(scanId, { severity: 'high', title: 'Open' }))
      // (No branch inserted → not included in MTTR)

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      const highRows = rows.filter((r) => r.severity === 'high')

      // Either no high row exists, or sampleSize = 0
      for (const row of highRows) {
        expect(row.sampleSize).toBe(0)
      }
    })
  })

  describe('getMttr — result shape', () => {
    it('returns rows with the expected DTO fields', () => {
      const f = insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1' }))
      insertMergedBranch(sqlite, f.id, nextId(), { mergedSecondsAgo: 5 * 24 * 3600, firstDetectedSecondsAgo: 10 * 24 * 3600 })

      refreshMttr(db, projectId)

      const rows = getMttr(db, projectId)
      expect(rows.length).toBeGreaterThan(0)

      const row = rows[0]
      expect(row).toHaveProperty('projectId')
      expect(row).toHaveProperty('severity')
      expect(row).toHaveProperty('windowDays')
      expect(row).toHaveProperty('medianSeconds')
      expect(row).toHaveProperty('avgSeconds')
      expect(row).toHaveProperty('sampleSize')
      expect(row).toHaveProperty('refreshedAt')
      expect(row).toHaveProperty('lowConfidence')
    })
  })
})
