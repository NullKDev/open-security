/**
 * tests/unit/repos/finding-comments.test.ts
 *
 * TDD RED → GREEN: T-024 + T-025 — finding-comments.repo
 *
 * Covers:
 * - createComment persists all fields
 * - listComments returns ascending created_at order
 * - listing non-existent finding_id returns empty array
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { createComment, listComments } from '@/lib/repos/finding-comments.repo'

describe('finding-comments.repo', () => {
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
      severity: 'high',
      confidence: 0.9,
      title: 'SQL Injection',
      description: 'Test finding',
      locationPath: 'src/db.ts',
      locationLineStart: 10,
    })

    findingId = finding.id
  })

  describe('createComment', () => {
    it('persists findingId, actor, and body', () => {
      const comment = createComment(db, {
        findingId,
        actor: 'alice@example.com',
        body: 'This needs immediate attention',
      })

      expect(comment.findingId).toBe(findingId)
      expect(comment.actor).toBe('alice@example.com')
      expect(comment.body).toBe('This needs immediate attention')
    })

    it('sets a unique id on the comment', () => {
      const c1 = createComment(db, { findingId, actor: 'alice', body: 'comment 1' })
      const c2 = createComment(db, { findingId, actor: 'bob', body: 'comment 2' })
      expect(c1.id).not.toBe(c2.id)
    })

    it('sets createdAt to an ISO timestamp', () => {
      const comment = createComment(db, { findingId, actor: 'alice', body: 'test' })
      expect(comment.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('listComments', () => {
    it('returns comments in ascending created_at order', async () => {
      createComment(db, { findingId, actor: 'alice', body: 'first' })
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 5))
      createComment(db, { findingId, actor: 'bob', body: 'second' })
      await new Promise((r) => setTimeout(r, 5))
      createComment(db, { findingId, actor: 'charlie', body: 'third' })

      const comments = listComments(db, findingId)
      expect(comments).toHaveLength(3)
      expect(comments[0]?.body).toBe('first')
      expect(comments[1]?.body).toBe('second')
      expect(comments[2]?.body).toBe('third')
    })

    it('returns empty array for non-existent finding_id', () => {
      const comments = listComments(db, 'non-existent-finding-id')
      expect(comments).toHaveLength(0)
      expect(Array.isArray(comments)).toBe(true)
    })

    it('only returns comments for the specified finding', () => {
      const project2 = createProject(db, { name: 'p2', sourceKind: 'local', sourceRef: '/tmp2' })
      const scan2 = createScan(db, { projectId: project2.id })
      const finding2 = insertFinding(db, {
        scanId: scan2.id,
        detector: 'semgrep',
        severity: 'low',
        confidence: 0.5,
        title: 'Other finding',
        description: '',
        locationPath: 'other.ts',
        locationLineStart: 1,
      })

      createComment(db, { findingId, actor: 'alice', body: 'for finding 1' })
      createComment(db, { findingId: finding2.id, actor: 'bob', body: 'for finding 2' })

      const comments1 = listComments(db, findingId)
      const comments2 = listComments(db, finding2.id)

      expect(comments1).toHaveLength(1)
      expect(comments2).toHaveLength(1)
      expect(comments1[0]?.body).toBe('for finding 1')
      expect(comments2[0]?.body).toBe('for finding 2')
    })
  })
})
