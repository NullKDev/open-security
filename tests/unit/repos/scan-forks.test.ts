/**
 * tests/unit/repos/scan-forks.test.ts
 *
 * TDD: T-027 (RED) → T-028 (GREEN)
 * Tests for scan-forks.repo.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  createFork,
  findForksByParentScanId,
} from '@/lib/repos/scan-forks.repo'

describe('scan-forks.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let parentScanId: string
  let childScanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const project = createProject(db, {
      name: 'test-project',
      sourceKind: 'local',
      sourceRef: '/tmp/repo',
    })
    const parentScan = createScan(db, { projectId: project.id })
    const childScan = createScan(db, { projectId: project.id })
    parentScanId = parentScan.id
    childScanId = childScan.id
  })

  describe('createFork', () => {
    it('creates a fork relationship record', () => {
      createFork(db, {
        id: 'fork-001',
        parentScanId,
        childScanId,
      })

      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks).toHaveLength(1)
      expect(forks[0].id).toBe('fork-001')
      expect(forks[0].parentScanId).toBe(parentScanId)
      expect(forks[0].childScanId).toBe(childScanId)
    })

    it('stores forkEventId when provided', () => {
      createFork(db, {
        id: 'fork-002',
        parentScanId,
        childScanId,
        forkEventId: 'evt-abc123',
      })

      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks[0].forkEventId).toBe('evt-abc123')
    })

    it('sets forkEventId to null when not provided', () => {
      createFork(db, {
        id: 'fork-003',
        parentScanId,
        childScanId,
      })

      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks[0].forkEventId).toBeNull()
    })

    it('throws on duplicate id', () => {
      createFork(db, { id: 'fork-dup', parentScanId, childScanId })
      expect(() => createFork(db, { id: 'fork-dup', parentScanId, childScanId })).toThrow()
    })

    it('child_scan_id is required (throws if FK is invalid)', () => {
      expect(() =>
        createFork(db, {
          id: 'fork-bad',
          parentScanId,
          childScanId: 'nonexistent-scan-id',
        })
      ).toThrow()
    })
  })

  describe('findForksByParentScanId', () => {
    it('returns empty array for a scan with no forks', () => {
      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks).toHaveLength(0)
    })

    it('returns multiple forks for the same parent scan', () => {
      const project = createProject(db, { name: 'p2', sourceKind: 'local', sourceRef: '/tmp/p2' })
      const child2 = createScan(db, { projectId: project.id })
      const child3 = createScan(db, { projectId: project.id })

      createFork(db, { id: 'fork-m1', parentScanId, childScanId })
      createFork(db, { id: 'fork-m2', parentScanId, childScanId: child2.id })
      createFork(db, { id: 'fork-m3', parentScanId, childScanId: child3.id })

      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks).toHaveLength(3)
    })

    it('returns only forks for the given parent scan', () => {
      const project = createProject(db, { name: 'p3', sourceKind: 'local', sourceRef: '/tmp/p3' })
      const otherParent = createScan(db, { projectId: project.id })
      const otherChild = createScan(db, { projectId: project.id })

      createFork(db, { id: 'fork-mine', parentScanId, childScanId })
      createFork(db, { id: 'fork-other', parentScanId: otherParent.id, childScanId: otherChild.id })

      const forks = findForksByParentScanId(db, parentScanId)
      expect(forks).toHaveLength(1)
      expect(forks[0].id).toBe('fork-mine')
    })
  })
})
