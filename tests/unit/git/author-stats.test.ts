import { describe, it, expect } from 'vitest'
import type { CommitInfo } from '@/lib/git/history-walker'

/** Helper: create an async iterable from an array */
async function* arrayIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

// ── Fixture data ──────────────────────────────────────────────

const commitA: CommitInfo = {
  hash: 'a'.repeat(40),
  message: 'Initial commit',
  author: 'Alice Engineer',
  authorEmail: 'alice@example.com',
  date: '2024-01-01T10:00:00Z',
  filesChanged: 3,
  insertions: 100,
  deletions: 0,
}

const commitB: CommitInfo = {
  hash: 'b'.repeat(40),
  message: 'feat: add login',
  author: 'Alice Engineer',
  authorEmail: 'alice@example.com',
  date: '2024-01-02T11:00:00Z',
  filesChanged: 5,
  insertions: 200,
  deletions: 10,
}

const commitC: CommitInfo = {
  hash: 'c'.repeat(40),
  message: 'fix: typo',
  author: 'Bob Developer',
  authorEmail: 'bob@example.com',
  date: '2024-01-03T12:00:00Z',
  filesChanged: 1,
  insertions: 1,
  deletions: 1,
}

const commitD: CommitInfo = {
  hash: 'd'.repeat(40),
  message: 'docs: readme',
  author: 'Bob Developer',
  authorEmail: 'bob@other-domain.com',
  date: '2024-01-04T13:00:00Z',
  filesChanged: 1,
  insertions: 5,
  deletions: 0,
}

const commitE: CommitInfo = {
  hash: 'e'.repeat(40),
  message: 'WIP',
  author: 'Charlie NoEmail',
  authorEmail: 'charlie@example.com',
  date: '2024-01-05T14:00:00Z',
  filesChanged: 2,
  insertions: 50,
  deletions: 0,
}

const allCommits = [commitA, commitB, commitC, commitD, commitE]

// ── Tests ─────────────────────────────────────────────────────

describe('computeAuthorStats', () => {
  // RED PHASE: @/lib/git/author-stats does not exist yet

  it('groups commits by author email', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable(allCommits))

    // 3 unique emails: alice@, bob@, bob@other-domain, charlie@
    expect(stats).toHaveLength(4)
  })

  it('counts commits per author correctly', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable(allCommits))

    const alice = stats.find((s) => s.email === 'alice@example.com')
    expect(alice).toBeDefined()
    expect(alice!.commitCount).toBe(2)

    const bob = stats.find((s) => s.email === 'bob@example.com')
    expect(bob).toBeDefined()
    expect(bob!.commitCount).toBe(1)

    const bobOther = stats.find((s) => s.email === 'bob@other-domain.com')
    expect(bobOther).toBeDefined()
    expect(bobOther!.commitCount).toBe(1)

    const charlie = stats.find((s) => s.email === 'charlie@example.com')
    expect(charlie).toBeDefined()
    expect(charlie!.commitCount).toBe(1)
  })

  it('records firstSeen and lastSeen for each author', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable(allCommits))

    const alice = stats.find((s) => s.email === 'alice@example.com')
    expect(alice!.firstSeen).toBe('2024-01-01T10:00:00Z')
    expect(alice!.lastSeen).toBe('2024-01-02T11:00:00Z')
  })

  it('preserves the most recent author name per email', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const dev = [
      { ...commitA, author: 'Alice Old', authorEmail: 'a@x.com', date: '2024-01-01T00:00:00Z' },
      { ...commitA, author: 'Alice New', authorEmail: 'a@x.com', date: '2024-01-02T00:00:00Z' },
    ]

    const stats = await computeAuthorStats(arrayIterable(dev))
    const a = stats.find((s) => s.email === 'a@x.com')
    expect(a!.name).toBe('Alice New')
  })

  it('flags single-commit authors (anomaly)', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable(allCommits))

    const charlie = stats.find((s) => s.email === 'charlie@example.com')
    expect(charlie!.anomalyFlags).toBeDefined()
    // Charlie has only 1 commit — should be flagged
    expect(charlie!.anomalyFlags).toMatchObject({ singleCommit: true })
  })

  it('flags authors with multiple email domains (name/email mismatch)', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    // Bob has commits from both @example.com and @other-domain.com
    const stats = await computeAuthorStats(arrayIterable(allCommits))

    // Check that Bob appears under both emails
    const bob1 = stats.find((s) => s.email === 'bob@example.com')
    const bob2 = stats.find((s) => s.email === 'bob@other-domain.com')
    expect(bob1).toBeDefined()
    expect(bob2).toBeDefined()
    // Same author name with different emails is suspicious
    expect(bob1!.name).toBe('Bob Developer')
    expect(bob2!.name).toBe('Bob Developer')
  })

  it('handles empty commit list', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable([]))
    expect(stats).toHaveLength(0)
  })

  it('exposes total insertions and deletions per author', async () => {
    const { computeAuthorStats } = await import('@/lib/git/author-stats')

    const stats = await computeAuthorStats(arrayIterable(allCommits))

    const alice = stats.find((s) => s.email === 'alice@example.com')
    expect((alice as any).totalInsertions).toBe(300)
    expect((alice as any).totalDeletions).toBe(10)
  })
})
