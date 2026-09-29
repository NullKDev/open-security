/**
 * tests/unit/posture/refresh.test.ts
 *
 * TDD: T-022 (RED) + T-023 (GREEN) — lib/posture/refresh.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: refreshPosture(projectId, scanId)
 * - computes severity counts from findings in the scan
 * - computes weighted score: critical×10 + high×5 + medium×2 + low×1 + info×0
 * - UPSERTs posture_snapshots for today's bucket date
 * - idempotent: calling twice for the same scan updates the same row
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { getTimeseries } from '@/lib/repos/posture.repo'
import { refreshPosture } from '@/lib/posture/refresh'
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

describe('refreshPosture', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp/repo' })
    projectId = proj.id
    const scan = createScan(db, { projectId })
    scanId = scan.id
  })

  it('upserts a posture snapshot for today with correct severity counts', () => {
    // Insert 2 critical, 3 high, 1 medium finding in the scan
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C1' }))
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C2' }))
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1' }))
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H2' }))
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H3' }))
    insertFinding(db, makeInput(scanId, { severity: 'medium', title: 'M1' }))

    refreshPosture(db, projectId, scanId)

    const today = new Date().toISOString().slice(0, 10)
    const series = getTimeseries(db, projectId, 1)
    const snap = series.find((s) => s.bucketDate === today)

    expect(snap).toBeTruthy()
    expect(snap!.countCritical).toBe(2)
    expect(snap!.countHigh).toBe(3)
    expect(snap!.countMedium).toBe(1)
    expect(snap!.countLow).toBe(0)
    expect(snap!.countInfo).toBe(0)
    expect(snap!.scanId).toBe(scanId)
  })

  it('computes weighted score: critical×10 + high×5 + medium×2 + low×1 + info×0', () => {
    // 1 critical, 2 high, 3 medium, 4 low, 5 info
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C1', detector: 'a' }))
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1', detector: 'b' }))
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H2', detector: 'c' }))
    insertFinding(db, makeInput(scanId, { severity: 'medium', title: 'M1', detector: 'd' }))
    insertFinding(db, makeInput(scanId, { severity: 'medium', title: 'M2', detector: 'e' }))
    insertFinding(db, makeInput(scanId, { severity: 'medium', title: 'M3', detector: 'f' }))
    insertFinding(db, makeInput(scanId, { severity: 'low', title: 'L1', detector: 'g' }))
    insertFinding(db, makeInput(scanId, { severity: 'low', title: 'L2', detector: 'h' }))
    insertFinding(db, makeInput(scanId, { severity: 'low', title: 'L3', detector: 'i' }))
    insertFinding(db, makeInput(scanId, { severity: 'low', title: 'L4', detector: 'j' }))
    insertFinding(db, makeInput(scanId, { severity: 'info', title: 'I1', detector: 'k' }))
    insertFinding(db, makeInput(scanId, { severity: 'info', title: 'I2', detector: 'l' }))
    insertFinding(db, makeInput(scanId, { severity: 'info', title: 'I3', detector: 'm' }))
    insertFinding(db, makeInput(scanId, { severity: 'info', title: 'I4', detector: 'n' }))
    insertFinding(db, makeInput(scanId, { severity: 'info', title: 'I5', detector: 'o' }))

    refreshPosture(db, projectId, scanId)

    const today = new Date().toISOString().slice(0, 10)
    const series = getTimeseries(db, projectId, 1)
    const snap = series.find((s) => s.bucketDate === today)

    // 1×10 + 2×5 + 3×2 + 4×1 + 5×0 = 10 + 10 + 6 + 4 + 0 = 30
    expect(snap!.weightedScore).toBe(30)
  })

  it('is idempotent — calling twice for the same scan produces exactly one row for today', () => {
    insertFinding(db, makeInput(scanId, { severity: 'high', title: 'H1' }))

    refreshPosture(db, projectId, scanId)
    refreshPosture(db, projectId, scanId)

    const today = new Date().toISOString().slice(0, 10)
    const series = getTimeseries(db, projectId, 1)
    const todayRows = series.filter((s) => s.bucketDate === today)

    expect(todayRows).toHaveLength(1)
  })

  it('counts only findings from the given scan, not other scans for the same project', () => {
    // Scan 1: 5 critical findings
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C1' }))
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C2' }))
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C3' }))
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C4' }))
    insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'C5' }))

    // Scan 2: 1 high finding (different scan, same project)
    const scan2 = createScan(db, { projectId })
    insertFinding(db, makeInput(scan2.id, { severity: 'high', title: 'H1' }))

    // refreshPosture for scan1 only
    refreshPosture(db, projectId, scanId)

    const today = new Date().toISOString().slice(0, 10)
    const series = getTimeseries(db, projectId, 1)
    const snap = series.find((s) => s.bucketDate === today)

    expect(snap!.countCritical).toBe(5)
    expect(snap!.countHigh).toBe(0)
  })

  it('returns the upserted snapshot DTO', () => {
    insertFinding(db, makeInput(scanId, { severity: 'medium', title: 'M1' }))

    const snap = refreshPosture(db, projectId, scanId)

    expect(snap).toBeTruthy()
    expect(snap.projectId).toBe(projectId)
    expect(snap.scanId).toBe(scanId)
    expect(typeof snap.weightedScore).toBe('number')
  })

  it('snapshot has scanId set to the triggering scan', () => {
    refreshPosture(db, projectId, scanId)

    const today = new Date().toISOString().slice(0, 10)
    const series = getTimeseries(db, projectId, 1)
    const snap = series.find((s) => s.bucketDate === today)

    expect(snap!.scanId).toBe(scanId)
  })
})
