/**
 * tests/unit/repos/scans-v02.test.ts
 *
 * TDD: T-B07 — scans.repo v0.2 additions
 * Tests: getDeltaFindings, getMostRecentCompletedScan, strategy/sha fields on createScan
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createScan, updateScanStatus, getDeltaFindings, getMostRecentCompletedScan } from '@/lib/repos/scans.repo'
import { findings, projects } from '@/lib/db/schema'

const TEST_PROJECT_ID = 'proj-v02-test'

function seedProject(db: ReturnType<typeof createTestDb>) {
  db.insert(projects).values({
    id: TEST_PROJECT_ID,
    name: 'v02-test',
    sourceKind: 'local',
    sourceRef: '/tmp/v02',
    createdAt: new Date().toISOString(),
  }).run()
}

describe('scans.repo — v0.2 additions', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    seedProject(db)
  })

  describe('createScan with strategy + SHA fields', () => {
    it('creates a standard scan with default strategy', () => {
      const scan = createScan(db, { projectId: TEST_PROJECT_ID })
      expect(scan.strategy).toBe('standard')
      expect(scan.baseSha).toBeNull()
      expect(scan.headSha).toBeNull()
    })

    it('creates a diff scan with strategy and SHAs', () => {
      const scan = createScan(db, {
        projectId: TEST_PROJECT_ID,
        strategy: 'diff',
        baseSha: 'abc123',
        headSha: 'def456',
        prNumber: 42,
      })
      expect(scan.strategy).toBe('diff')
      expect(scan.baseSha).toBe('abc123')
      expect(scan.headSha).toBe('def456')
      expect(scan.prNumber).toBe(42)
    })
  })

  describe('getMostRecentCompletedScan', () => {
    it('returns null when no completed scan exists', () => {
      const result = getMostRecentCompletedScan(db, TEST_PROJECT_ID)
      expect(result).toBeNull()
    })

    it('returns the most recent completed scan', () => {
      const s1 = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, s1.id, 'done')

      const s2 = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, s2.id, 'done')

      const result = getMostRecentCompletedScan(db, TEST_PROJECT_ID)
      expect(result).toBeDefined()
      expect(result!.id).toBe(s2.id)
    })

    it('ignores failed and pending scans', () => {
      const s1 = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, s1.id, 'done')

      const s2 = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, s2.id, 'failed')

      const s3 = createScan(db, { projectId: TEST_PROJECT_ID })
      // s3 stays pending

      const result = getMostRecentCompletedScan(db, TEST_PROJECT_ID)
      expect(result!.id).toBe(s1.id)
    })
  })

  describe('getDeltaFindings', () => {
    it('returns findings in child that are not in parent by dedup_key', () => {
      const parent = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, parent.id, 'done')

      const child = createScan(db, {
        projectId: TEST_PROJECT_ID,
        strategy: 'diff',
        baseSha: 'aaa',
        headSha: 'bbb',
      })
      updateScanStatus(db, child.id, 'done')

      // Parent has finding with dedup_key 'key-1'
      db.insert(findings).values({
        id: 'f-parent-1',
        scanId: parent.id,
        detector: 'gitleaks',
        severity: 'high',
        confidence: 0.9,
        title: 'Secret',
        locationPath: 'file.ts',
        locationLineStart: 1,
        createdAt: new Date().toISOString(),
        dedupKey: 'key-1',
      }).run()

      // Child has 'key-1' (pre-existing) and 'key-2' (new)
      db.insert(findings).values([
        {
          id: 'f-child-1',
          scanId: child.id,
          detector: 'gitleaks',
          severity: 'high',
          confidence: 0.9,
          title: 'Secret',
          locationPath: 'file.ts',
          locationLineStart: 1,
          createdAt: new Date().toISOString(),
          dedupKey: 'key-1',
        },
        {
          id: 'f-child-2',
          scanId: child.id,
          detector: 'semgrep',
          severity: 'medium',
          confidence: 0.8,
          title: 'Injection',
          locationPath: 'query.ts',
          locationLineStart: 10,
          createdAt: new Date().toISOString(),
          dedupKey: 'key-2',
        },
      ]).run()

      const delta = getDeltaFindings(db, child.id, parent.id)
      expect(delta).toHaveLength(1)
      expect(delta[0].id).toBe('f-child-2')
      expect(delta[0].dedupKey).toBe('key-2')
    })

    it('returns all child findings when parent has no findings', () => {
      const parent = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, parent.id, 'done')

      const child = createScan(db, { projectId: TEST_PROJECT_ID, strategy: 'diff', baseSha: 'a', headSha: 'b' })
      updateScanStatus(db, child.id, 'done')

      db.insert(findings).values({
        id: 'f-only',
        scanId: child.id,
        detector: 'gitleaks',
        severity: 'critical',
        confidence: 1.0,
        title: 'Token',
        locationPath: 'env.ts',
        locationLineStart: 5,
        createdAt: new Date().toISOString(),
        dedupKey: 'key-new',
      }).run()

      const delta = getDeltaFindings(db, child.id, parent.id)
      expect(delta).toHaveLength(1)
    })

    it('returns empty array when all child findings exist in parent', () => {
      const parent = createScan(db, { projectId: TEST_PROJECT_ID })
      updateScanStatus(db, parent.id, 'done')

      const child = createScan(db, { projectId: TEST_PROJECT_ID, strategy: 'diff', baseSha: 'a', headSha: 'b' })
      updateScanStatus(db, child.id, 'done')

      db.insert(findings).values({
        id: 'f-p1',
        scanId: parent.id,
        detector: 'gitleaks',
        severity: 'high',
        confidence: 0.9,
        title: 'Secret',
        locationPath: 'f.ts',
        locationLineStart: 1,
        createdAt: new Date().toISOString(),
        dedupKey: 'shared-key',
      }).run()

      db.insert(findings).values({
        id: 'f-c1',
        scanId: child.id,
        detector: 'gitleaks',
        severity: 'high',
        confidence: 0.9,
        title: 'Secret',
        locationPath: 'f.ts',
        locationLineStart: 1,
        createdAt: new Date().toISOString(),
        dedupKey: 'shared-key',
      }).run()

      const delta = getDeltaFindings(db, child.id, parent.id)
      expect(delta).toHaveLength(0)
    })
  })
})
