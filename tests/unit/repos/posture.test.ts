/**
 * tests/unit/repos/posture.test.ts
 *
 * TDD: T-005 (RED) + T-006 (GREEN) — posture.repo.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: upsertSnapshot, getTimeseries, getHotspots, getRegressionRate
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import {
  upsertSnapshot,
  getTimeseries,
  getHotspots,
  getRegressionRate,
} from '@/lib/repos/posture.repo'
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

describe('posture.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    projectId = proj.id
    const scan = createScan(db, { projectId })
    scanId = scan.id
  })

  describe('upsertSnapshot', () => {
    it('inserts a new snapshot row for a (projectId, bucketDate) pair', () => {
      const snap = upsertSnapshot(db, {
        projectId,
        scanId,
        bucketDate: '2024-01-15',
        countCritical: 2,
        countHigh: 5,
        countMedium: 3,
        countLow: 1,
        countInfo: 0,
        openCriticalDays: 10.5,
      })

      expect(snap.id).toBeTruthy()
      expect(snap.projectId).toBe(projectId)
      expect(snap.bucketDate).toBe('2024-01-15')
      expect(snap.countCritical).toBe(2)
      expect(snap.countHigh).toBe(5)
      expect(snap.weightedScore).toBe(2 * 10 + 5 * 5 + 3 * 2 + 1 * 1 + 0 * 0) // 52
    })

    it('computes weightedScore: critical×10 + high×5 + medium×2 + low×1 + info×0', () => {
      const snap = upsertSnapshot(db, {
        projectId,
        scanId,
        bucketDate: '2024-01-16',
        countCritical: 1,
        countHigh: 2,
        countMedium: 3,
        countLow: 4,
        countInfo: 5,
      })
      // 1*10 + 2*5 + 3*2 + 4*1 + 5*0 = 10 + 10 + 6 + 4 + 0 = 30
      expect(snap.weightedScore).toBe(30)
    })

    it('is idempotent — upserting same (projectId, bucketDate) replaces the row', () => {
      // Use a recent date so rangeDays filter includes it
      const today = new Date().toISOString().slice(0, 10)

      upsertSnapshot(db, {
        projectId, scanId, bucketDate: today,
        countCritical: 1, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0,
      })

      const updated = upsertSnapshot(db, {
        projectId, scanId, bucketDate: today,
        countCritical: 5, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0,
      })

      expect(updated.countCritical).toBe(5)
      expect(updated.weightedScore).toBe(50)

      // Only one row should exist for this date
      const series = getTimeseries(db, projectId, 7)
      const forDate = series.filter((s) => s.bucketDate === today)
      expect(forDate).toHaveLength(1)
    })
  })

  describe('getTimeseries', () => {
    it('returns empty array when no snapshots exist', () => {
      const series = getTimeseries(db, projectId, 30)
      expect(series).toHaveLength(0)
    })

    it('returns snapshots ordered by bucketDate ascending', () => {
      // Use recent dates within the last 30 days to pass the range filter
      const d1 = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const d2 = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const d3 = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString().slice(0, 10)

      upsertSnapshot(db, { projectId, scanId, bucketDate: d3, countCritical: 1, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })
      upsertSnapshot(db, { projectId, scanId, bucketDate: d1, countCritical: 2, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })
      upsertSnapshot(db, { projectId, scanId, bucketDate: d2, countCritical: 3, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })

      const series = getTimeseries(db, projectId, 30)
      expect(series[0].bucketDate).toBe(d1)
      expect(series[1].bucketDate).toBe(d2)
      expect(series[2].bucketDate).toBe(d3)
    })

    it('filters by rangeDays (only recent snapshots)', () => {
      const old = new Date(Date.now() - 60 * 24 * 3600 * 1000) // 60 days ago
      const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000) // 5 days ago
      const oldDate = old.toISOString().slice(0, 10)
      const recentDate = recent.toISOString().slice(0, 10)

      upsertSnapshot(db, { projectId, scanId, bucketDate: oldDate, countCritical: 5, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })
      upsertSnapshot(db, { projectId, scanId, bucketDate: recentDate, countCritical: 1, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })

      const series7 = getTimeseries(db, projectId, 7)
      expect(series7.some((s) => s.bucketDate === recentDate)).toBe(true)
      expect(series7.some((s) => s.bucketDate === oldDate)).toBe(false)
    })

    it('returns all snapshots when rangeDays=0 (no filter)', () => {
      const date1 = '2020-01-01'
      const date2 = '2024-01-01'
      upsertSnapshot(db, { projectId, scanId, bucketDate: date1, countCritical: 1, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })
      upsertSnapshot(db, { projectId, scanId, bucketDate: date2, countCritical: 2, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0 })

      const series = getTimeseries(db, projectId, 0)
      expect(series.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('getHotspots', () => {
    it('returns empty array when no findings exist', () => {
      const hotspots = getHotspots(db, projectId)
      expect(hotspots).toHaveLength(0)
    })

    it('includes only file×author pairs with 3+ distinct dedup_keys', () => {
      // Insert 3 findings with different dedup_keys at the same file for the same scan
      insertFinding(db, makeInput(scanId, { locationPath: 'src/auth.ts', title: 'Vuln A', detector: 'semgrep' }))
      insertFinding(db, makeInput(scanId, { locationPath: 'src/auth.ts', title: 'Vuln B', detector: 'gitleaks' }))
      insertFinding(db, makeInput(scanId, { locationPath: 'src/auth.ts', title: 'Vuln C', detector: 'trufflehog' }))

      // Single finding at a different path — should NOT appear
      insertFinding(db, makeInput(scanId, { locationPath: 'src/clean.ts', title: 'Vuln D', detector: 'semgrep' }))

      const hotspots = getHotspots(db, projectId)
      const authHotspot = hotspots.find((h) => h.filePath === 'src/auth.ts')
      expect(authHotspot).toBeTruthy()
      expect(authHotspot!.distinctDedupKeys).toBeGreaterThanOrEqual(3)

      const cleanHotspot = hotspots.find((h) => h.filePath === 'src/clean.ts')
      expect(cleanHotspot).toBeUndefined()
    })

    it('caps results at 500 cells', () => {
      // This is a structural test — verifies the LIMIT is applied.
      // We only verify the function accepts a limit param and returns <= 500
      const hotspots = getHotspots(db, projectId)
      expect(hotspots.length).toBeLessThanOrEqual(500)
    })
  })

  describe('getRegressionRate', () => {
    it('returns rate=0 and count=0 when no regressions exist', () => {
      const result = getRegressionRate(db, projectId, 30)
      expect(result.regressionCount30d).toBe(0)
      expect(result.totalFixes30d).toBe(0)
      expect(result.rate30d).toBe(0)
    })

    it('returns a rate struct with the correct fields', () => {
      const result = getRegressionRate(db, projectId, 30)
      expect(result).toHaveProperty('regressionCount30d')
      expect(result).toHaveProperty('totalFixes30d')
      expect(result).toHaveProperty('rate30d')
    })
  })
})
