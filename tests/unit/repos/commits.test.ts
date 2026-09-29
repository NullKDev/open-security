import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  upsertCommit,
  getCommitBySha,
  listCommitsByScan,
} from '@/lib/repos/commits.repo'
import type { CommitInput } from '@/lib/repos/commits.repo'

describe('commits.repo', () => {
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

  const input: CommitInput = {
    sha: 'abc123def',
    scanId: '', // set in tests
    authorEmail: 'dev@example.com',
    authorName: 'Dev User',
    authoredAt: '2024-01-15T10:30:00Z',
    message: 'fix: resolve security issue',
    filesChanged: 3,
    insertions: 25,
    deletions: 10,
  }

  it('inserts a commit and reads it back by sha', () => {
    upsertCommit(db, { ...input, scanId })
    const commit = getCommitBySha(db, input.sha, scanId)
    expect(commit).toBeDefined()
    expect(commit!.authorEmail).toBe('dev@example.com')
    expect(commit!.message).toBe('fix: resolve security issue')
  })

  it('returns undefined for non-existent sha', () => {
    expect(getCommitBySha(db, 'nonexistent', scanId)).toBeUndefined()
  })

  it('lists all commits for a scan', () => {
    upsertCommit(db, { ...input, sha: 'aaa', scanId })
    upsertCommit(db, { ...input, sha: 'bbb', scanId })
    const commits = listCommitsByScan(db, scanId)
    expect(commits).toHaveLength(2)
  })

  it('upsert updates existing commit (same sha+scanId)', () => {
    upsertCommit(db, { ...input, scanId, riskScore: 0.2 })
    upsertCommit(db, { ...input, scanId, riskScore: 0.9 })
    const commits = listCommitsByScan(db, scanId)
    expect(commits).toHaveLength(1)
    expect(commits[0].riskScore).toBe(0.9)
  })

  it('stores filesChanged, insertions, and deletions', () => {
    upsertCommit(db, { ...input, scanId, filesChanged: 12, insertions: 500, deletions: 30 })
    const commit = getCommitBySha(db, input.sha, scanId)
    expect(commit!.filesChanged).toBe(12)
    expect(commit!.insertions).toBe(500)
    expect(commit!.deletions).toBe(30)
  })
})
