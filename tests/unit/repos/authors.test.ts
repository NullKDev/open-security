import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  upsertAuthor,
  getAuthor,
  listAuthorsByScan,
} from '@/lib/repos/authors.repo'
import type { AuthorInput } from '@/lib/repos/authors.repo'

describe('authors.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, {
      name: 'test',
      sourceKind: 'github',
      sourceRef: 'url',
    })
    const scan = createScan(db, { projectId: proj.id })
    scanId = scan.id
  })

  it('inserts an author and reads back by scanId+email', () => {
    upsertAuthor(db, {
      scanId,
      email: 'dev@example.com',
      name: 'Dev User',
      commitCount: 5,
    })

    const author = getAuthor(db, scanId, 'dev@example.com')
    expect(author).toBeDefined()
    expect(author!.name).toBe('Dev User')
    expect(author!.commitCount).toBe(5)
  })

  it('returns undefined for non-existent author', () => {
    expect(getAuthor(db, scanId, 'nobody@example.com')).toBeUndefined()
  })

  it('lists all authors for a scan', () => {
    upsertAuthor(db, { scanId, email: 'a@x.com', name: 'A', commitCount: 3 })
    upsertAuthor(db, { scanId, email: 'b@x.com', name: 'B', commitCount: 7 })
    const authors = listAuthorsByScan(db, scanId)
    expect(authors).toHaveLength(2)
  })

  it('upsert updates existing author (same scanId+email)', () => {
    upsertAuthor(db, { scanId, email: 'dev@example.com', name: 'Old', commitCount: 1 })
    upsertAuthor(db, { scanId, email: 'dev@example.com', name: 'New', commitCount: 10 })
    const author = getAuthor(db, scanId, 'dev@example.com')
    expect(author!.name).toBe('New')
    expect(author!.commitCount).toBe(10)
  })

  it('stores anomaly flags as JSON', () => {
    upsertAuthor(db, {
      scanId,
      email: 'odd@example.com',
      name: 'Odd',
      commitCount: 1,
      anomalyFlags: { singleCommit: true, domainOutlier: false },
    })
    const author = getAuthor(db, scanId, 'odd@example.com')
    expect(author!.anomalyFlags).toEqual({ singleCommit: true, domainOutlier: false })
  })
})
