/**
 * tests/unit/repos/finding-timelines.test.ts
 *
 * TDD: T-023 (RED) → T-024 (GREEN)
 * Tests for finding-timelines.repo.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { findings } from '@/lib/db/schema'
import {
  upsertFindingTimeline,
  findTimelineByFindingId,
  invalidateTimeline,
} from '@/lib/repos/finding-timelines.repo'

describe('finding-timelines.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const project = createProject(db, {
      name: 'test-project',
      sourceKind: 'local',
      sourceRef: '/tmp/repo',
    })
    const scan = createScan(db, { projectId: project.id })
    const finding = insertFinding(db, {
      scanId: scan.id,
      detector: 'gitleaks',
      severity: 'high',
      confidence: 0.9,
      title: 'AWS secret key',
      locationPath: 'src/config.ts',
      locationLineStart: 10,
    })
    findingId = finding.id
  })

  describe('upsertFindingTimeline — insert', () => {
    it('inserts a timeline row for a finding', () => {
      const commits = [
        { hash: 'abc123', author: 'Alice', email: 'alice@example.com', date: '2024-01-01T00:00:00Z', action: 'introduce' as const },
      ]

      upsertFindingTimeline(db, findingId, {
        id: 'ft-001',
        commits,
        suspectedDeploys: 2,
        partial: false,
      })

      const tl = findTimelineByFindingId(db, findingId)
      expect(tl).not.toBeNull()
      expect(tl!.findingId).toBe(findingId)
      expect(tl!.commits).toHaveLength(1)
      expect(tl!.commits[0].hash).toBe('abc123')
      expect(tl!.commits[0].action).toBe('introduce')
      expect(tl!.suspectedDeploys).toBe(2)
      expect(tl!.partial).toBe(false)
    })

    it('stores multiple commits in order', () => {
      const commits = [
        { hash: 'aaa', author: 'Alice', email: 'a@example.com', date: '2024-01-01T00:00:00Z', action: 'introduce' as const },
        { hash: 'bbb', author: 'Bob', email: 'b@example.com', date: '2024-02-01T00:00:00Z', action: 'remove' as const },
      ]

      upsertFindingTimeline(db, findingId, {
        id: 'ft-002',
        commits,
        suspectedDeploys: 0,
        partial: true,
      })

      const tl = findTimelineByFindingId(db, findingId)
      expect(tl!.commits).toHaveLength(2)
      expect(tl!.commits[0].hash).toBe('aaa')
      expect(tl!.commits[1].hash).toBe('bbb')
      expect(tl!.partial).toBe(true)
    })
  })

  describe('upsertFindingTimeline — update', () => {
    it('updates commits on second upsert for same findingId', () => {
      const commits1 = [
        { hash: 'c1', author: 'Alice', email: 'a@x.com', date: '2024-01-01T00:00:00Z', action: 'introduce' as const },
      ]
      upsertFindingTimeline(db, findingId, { id: 'ft-003', commits: commits1, suspectedDeploys: 1, partial: false })

      const commits2 = [
        { hash: 'c2', author: 'Bob', email: 'b@x.com', date: '2024-03-01T00:00:00Z', action: 'remove' as const },
      ]
      upsertFindingTimeline(db, findingId, { id: 'ft-003', commits: commits2, suspectedDeploys: 3, partial: false })

      const tl = findTimelineByFindingId(db, findingId)
      expect(tl!.commits).toHaveLength(1)
      expect(tl!.commits[0].hash).toBe('c2')
      expect(tl!.suspectedDeploys).toBe(3)
    })
  })

  describe('findTimelineByFindingId', () => {
    it('returns null for a finding with no timeline', () => {
      const result = findTimelineByFindingId(db, findingId)
      expect(result).toBeNull()
    })
  })

  describe('invalidateTimeline', () => {
    it('sets timeline_computed_at to null on the findings row', () => {
      // First set a non-null value using drizzle update
      db.update(findings)
        .set({ timelineComputedAt: '2024-01-01T00:00:00Z' })
        .where(eq(findings.id, findingId))
        .run()

      // Verify it is set
      const before = db
        .select({ timelineComputedAt: findings.timelineComputedAt })
        .from(findings)
        .where(eq(findings.id, findingId))
        .get()
      expect(before?.timelineComputedAt).not.toBeNull()

      invalidateTimeline(db, findingId)

      const after = db
        .select({ timelineComputedAt: findings.timelineComputedAt })
        .from(findings)
        .where(eq(findings.id, findingId))
        .get()
      expect(after?.timelineComputedAt).toBeNull()
    })

    it('is a no-op when timeline_computed_at is already null', () => {
      expect(() => invalidateTimeline(db, findingId)).not.toThrow()
    })
  })
})
