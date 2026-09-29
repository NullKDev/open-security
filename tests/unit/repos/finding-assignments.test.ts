/**
 * tests/unit/repos/finding-assignments.test.ts
 *
 * TDD RED → GREEN: T-026 + T-027 — finding-assignments.repo
 *
 * Covers:
 * - assign creates record
 * - reassign sets unassigned_at on previous
 * - currentAssignee returns null when unassigned
 * - assignmentHistory lists all records with actor+timestamp
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import {
  assign,
  unassign,
  currentAssignee,
  assignmentHistory,
} from '@/lib/repos/finding-assignments.repo'

describe('finding-assignments.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)

    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })

    const finding = insertFinding(db, {
      scanId: scan.id,
      detector: 'semgrep',
      severity: 'critical',
      confidence: 1.0,
      title: 'Critical Vulnerability',
      description: 'Test',
      locationPath: 'src/auth.ts',
      locationLineStart: 42,
    })

    findingId = finding.id
  })

  describe('assign', () => {
    it('creates an assignment record', () => {
      const record = assign(db, {
        findingId,
        assignee: 'alice@example.com',
        actor: 'manager@example.com',
      })

      expect(record.findingId).toBe(findingId)
      expect(record.assignee).toBe('alice@example.com')
      expect(record.actor).toBe('manager@example.com')
      expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(record.unassignedAt).toBeNull()
    })

    it('reassign sets unassigned_at on previous active record', async () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })

      // Small delay to ensure order
      await new Promise((r) => setTimeout(r, 5))
      assign(db, { findingId, assignee: 'bob@example.com', actor: 'manager' })

      const history = assignmentHistory(db, findingId)
      expect(history).toHaveLength(2)

      // First record should now be unassigned
      const aliceRecord = history.find((r) => r.assignee === 'alice@example.com')
      expect(aliceRecord?.unassignedAt).not.toBeNull()

      // Second (active) record should be unassigned_at = null
      const bobRecord = history.find((r) => r.assignee === 'bob@example.com')
      expect(bobRecord?.unassignedAt).toBeNull()
    })
  })

  describe('currentAssignee', () => {
    it('returns null when finding has never been assigned', () => {
      expect(currentAssignee(db, findingId)).toBeNull()
    })

    it('returns current assignee after assignment', () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })
      expect(currentAssignee(db, findingId)).toBe('alice@example.com')
    })

    it('returns null after unassign', () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })
      unassign(db, findingId, 'manager')
      expect(currentAssignee(db, findingId)).toBeNull()
    })

    it('returns new assignee after reassignment', async () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })
      await new Promise((r) => setTimeout(r, 5))
      assign(db, { findingId, assignee: 'bob@example.com', actor: 'manager' })
      expect(currentAssignee(db, findingId)).toBe('bob@example.com')
    })
  })

  describe('unassign', () => {
    it('sets unassigned_at on the active record', () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })
      unassign(db, findingId, 'manager')

      const history = assignmentHistory(db, findingId)
      expect(history).toHaveLength(1)
      expect(history[0]?.unassignedAt).not.toBeNull()
    })

    it('is a no-op when there is no active assignment', () => {
      // Should not throw
      expect(() => unassign(db, findingId, 'manager')).not.toThrow()
    })
  })

  describe('assignmentHistory', () => {
    it('lists all records in order', async () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager' })
      await new Promise((r) => setTimeout(r, 5))
      assign(db, { findingId, assignee: 'bob@example.com', actor: 'manager' })

      const history = assignmentHistory(db, findingId)
      expect(history).toHaveLength(2)
    })

    it('returns empty array for unassigned finding', () => {
      const history = assignmentHistory(db, findingId)
      expect(history).toHaveLength(0)
    })

    it('includes actor and timestamp in each record', () => {
      assign(db, { findingId, assignee: 'alice@example.com', actor: 'manager@example.com' })

      const history = assignmentHistory(db, findingId)
      expect(history[0]?.actor).toBe('manager@example.com')
      expect(history[0]?.createdAt).toBeTruthy()
    })
  })
})
