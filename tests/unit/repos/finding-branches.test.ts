/**
 * tests/unit/repos/finding-branches.test.ts
 *
 * TDD: T-B10 — Finding branches repo
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import {
  createBranchRecord,
  updateBranchStatus,
  getBranchByFindingId,
  markStaleCreating,
} from '@/lib/repos/finding-branches.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

function makeInput(scanId: string, suffix = ''): CreateFindingInput {
  return {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: `SQL Injection ${suffix}`,
    locationPath: `src/auth/login${suffix}.ts`,
    locationLineStart: 10,
  }
}

describe('finding-branches.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(db, { projectId: proj.id })
    const finding = insertFinding(db, makeInput(scan.id))
    findingId = finding.id
  })

  describe('createBranchRecord', () => {
    it('creates a branch record with status=pending', () => {
      const branch = createBranchRecord(db, findingId)
      expect(branch.status).toBe('pending')
      expect(branch.findingId).toBe(findingId)
    })

    it('creates branch with null branchRef and applyError initially', () => {
      const branch = createBranchRecord(db, findingId)
      expect(branch.branchRef).toBeNull()
      expect(branch.applyError).toBeNull()
    })

    it('has a non-null createdAt timestamp', () => {
      const branch = createBranchRecord(db, findingId)
      expect(branch.createdAt).toBeTruthy()
    })
  })

  describe('updateBranchStatus', () => {
    it('transitions status from pending to creating', () => {
      const branch = createBranchRecord(db, findingId)
      const updated = updateBranchStatus(db, branch.id, 'creating')
      expect(updated.status).toBe('creating')
    })

    it('transitions status to apply_failed and stores applyError', () => {
      const branch = createBranchRecord(db, findingId)
      const updated = updateBranchStatus(db, branch.id, 'apply_failed', {
        applyError: 'patch does not apply: context mismatch',
      })
      expect(updated.status).toBe('apply_failed')
      expect(updated.applyError).toBe('patch does not apply: context mismatch')
    })

    it('transitions status to created and stores branchRef', () => {
      const branch = createBranchRecord(db, findingId)
      const updated = updateBranchStatus(db, branch.id, 'created', {
        branchRef: 'sec/fix/abc12345',
        testsPassed: 1,
      })
      expect(updated.status).toBe('created')
      expect(updated.branchRef).toBe('sec/fix/abc12345')
      expect(updated.testsPassed).toBe(1)
    })

    it('updates updatedAt on every status transition', () => {
      const branch = createBranchRecord(db, findingId)
      const updated = updateBranchStatus(db, branch.id, 'creating')
      expect(updated.updatedAt).toBeTruthy()
    })
  })

  describe('getBranchByFindingId', () => {
    it('returns the current branch row for a finding', () => {
      const created = createBranchRecord(db, findingId)
      const found = getBranchByFindingId(db, findingId)
      expect(found?.id).toBe(created.id)
      expect(found?.status).toBe('pending')
    })

    it('returns undefined when no branch exists for the finding', () => {
      const result = getBranchByFindingId(db, 'nonexistent-finding-id')
      expect(result).toBeUndefined()
    })

    it('reflects updated status after status transition', () => {
      const branch = createBranchRecord(db, findingId)
      updateBranchStatus(db, branch.id, 'creating')
      const found = getBranchByFindingId(db, findingId)
      expect(found?.status).toBe('creating')
    })
  })

  describe('UNIQUE constraint', () => {
    it('prevents a second active branch for the same finding', () => {
      createBranchRecord(db, findingId)
      expect(() => createBranchRecord(db, findingId)).toThrow()
    })
  })

  describe('markStaleCreating', () => {
    it('marks non-terminal branches older than threshold as apply_failed', () => {
      const branch = createBranchRecord(db, findingId)

      // Manually set created_at to the past (older than threshold)
      const oldTime = new Date(Date.now() - 15 * 60_000).toISOString() // 15 min ago
      db.$client.prepare("UPDATE finding_branches SET created_at = ?, status = 'creating' WHERE id = ?").run(
        oldTime, branch.id
      )

      markStaleCreating(db, 10 * 60_000) // 10 min threshold

      const updated = getBranchByFindingId(db, findingId)
      expect(updated?.status).toBe('apply_failed')
    })

    it('does not affect terminal branches (created, apply_failed, tests_failed)', () => {
      const branch = createBranchRecord(db, findingId)
      updateBranchStatus(db, branch.id, 'apply_failed')

      // The branch is terminal - markStaleCreating should not touch it
      markStaleCreating(db, 0) // 0ms threshold = all non-terminal branches

      const found = getBranchByFindingId(db, findingId)
      expect(found?.status).toBe('apply_failed')
      // applyError should NOT be overwritten with 'interrupted'
    })
  })
})
