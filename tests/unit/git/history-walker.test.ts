import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { simpleGit } from 'simple-git'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CommitInfo } from '@/lib/git/history-walker'

const repoDir = join(tmpdir(), `os-test-walker-${Date.now()}`)

// ── Fixture repo setup ───────────────────────────────────────
async function createFixtureRepo(): Promise<void> {
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true })
  mkdirSync(repoDir, { recursive: true })

  const git = simpleGit({ baseDir: repoDir })
  await git.init(['-b', 'main'])
  await git.addConfig('user.email', 'ci@test.example')
  await git.addConfig('user.name', 'CI Bot')

  // Commit 1
  writeFileSync(join(repoDir, 'README.md'), '# Fixture Repo')
  await git.add('.')
  await git.commit('Initial commit: scaffold project')

  // Commit 2
  mkdirSync(join(repoDir, 'src'), { recursive: true })
  writeFileSync(join(repoDir, 'src/index.ts'), 'export const hello = "world"')
  await git.add('.')
  await git.commit('feat: add hello module')

  // Commit 3 — multi-file
  writeFileSync(join(repoDir, 'src/utils.ts'), 'export function add(a: number, b: number) { return a + b }')
  writeFileSync(join(repoDir, 'src/types.ts'), 'export type UUID = string')
  await git.add('.')
  await git.commit('feat: add utils and types')

  // Commit 4 — deletion heavy
  mkdirSync(join(repoDir, 'legacy'), { recursive: true })
  writeFileSync(join(repoDir, 'legacy/old.js'), 'var x=1;var y=2;var z=3')
  await git.add('.')
  await git.commit('chore: add legacy module')
  rmSync(join(repoDir, 'legacy'), { recursive: true })
  await git.rm(['legacy/old.js'])
  await git.commit('refactor: remove legacy code')

  // Commit 5 — binary-ish commit (large insertions)
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}: lorem ipsum dolor sit amet`)
  writeFileSync(join(repoDir, 'data.csv'), lines.join('\n'))
  await git.add('.')
  await git.commit('data: add dataset')
}

async function cleanupFixtureRepo(): Promise<void> {
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true })
}

// ── Tests ─────────────────────────────────────────────────────

describe('walkHistory', () => {
  beforeAll(async () => {
    await createFixtureRepo()
  })

  afterAll(async () => {
    await cleanupFixtureRepo()
  })

  // RED PHASE: @/lib/git/history-walker does not exist yet
  it('yields all 5 fixture commits (at minimum)', async () => {
    const { walkHistory } = await import('@/lib/git/history-walker')

    const commits: CommitInfo[] = []
    const gen = walkHistory(repoDir)

    for await (const commit of gen) {
      commits.push(commit)
    }

    // At least the 5 commits we explicitly created
    expect(commits.length).toBeGreaterThanOrEqual(5)

    // Verify all known messages are present
    const messages = commits.map((c) => c.message)
    expect(messages).toContain('Initial commit: scaffold project')
    expect(messages).toContain('feat: add hello module')
    expect(messages).toContain('feat: add utils and types')
    expect(messages).toContain('refactor: remove legacy code')
    expect(messages).toContain('data: add dataset')
  })

  it('each commit has hash, message, author, authorEmail, date, filesChanged, insertions, deletions', async () => {
    const { walkHistory } = await import('@/lib/git/history-walker')

    const gen = walkHistory(repoDir)
    let count = 0
    for await (const commit of gen) {
      expect(typeof commit.hash).toBe('string')
      expect(commit.hash.length).toBeGreaterThanOrEqual(40)
      expect(typeof commit.message).toBe('string')
      expect(typeof commit.author).toBe('string')
      expect(typeof commit.authorEmail).toBe('string')
      expect(typeof commit.date).toBe('string')
      expect(typeof commit.filesChanged).toBe('number')
      expect('insertions' in commit).toBe(true)
      expect(typeof commit.insertions).toBe('number')
      expect('deletions' in commit).toBe(true)
      expect(typeof commit.deletions).toBe('number')
      count++
    }
    expect(count).toBeGreaterThanOrEqual(5)
  })

  it('commits are yielded in reverse chronological order (newest first)', async () => {
    const { walkHistory } = await import('@/lib/git/history-walker')

    const dates: string[] = []
    for await (const commit of walkHistory(repoDir)) {
      dates.push(commit.date)
    }

    // Verify they're in descending order
    for (let i = 0; i < dates.length - 1; i++) {
      expect(new Date(dates[i]).getTime()).toBeGreaterThanOrEqual(
        new Date(dates[i + 1]).getTime(),
      )
    }
  })

  it('finds the newest known commit ("data: add dataset") early', async () => {
    const { walkHistory } = await import('@/lib/git/history-walker')

    const gen = walkHistory(repoDir)
    // First few commits should include "data: add dataset"
    const firstThree: string[] = []
    for await (const commit of gen) {
      firstThree.push(commit.message)
      if (firstThree.length >= 3) break
    }
    expect(firstThree).toContain('data: add dataset')
  })

  it('finds the oldest known commit ("Initial commit: scaffold project") at or near end', async () => {
    const { walkHistory } = await import('@/lib/git/history-walker')

    const all: string[] = []
    for await (const commit of walkHistory(repoDir)) {
      all.push(commit.message)
    }
    // The oldest commit should be among the last 3 entries
    const lastThree = all.slice(-3)
    expect(lastThree).toContain('Initial commit: scaffold project')
  })

  it('handles empty repo (no commits)', async () => {
    const emptyDir = join(tmpdir(), `os-empty-${Date.now()}`)
    mkdirSync(emptyDir, { recursive: true })
    const git = simpleGit({ baseDir: emptyDir })
    await git.init()

    try {
      const { walkHistory } = await import('@/lib/git/history-walker')
      const commits: unknown[] = []
      for await (const commit of walkHistory(emptyDir)) {
        commits.push(commit)
      }
      expect(commits).toHaveLength(0)
    } finally {
      if (existsSync(emptyDir)) rmSync(emptyDir, { recursive: true })
    }
  })
})
