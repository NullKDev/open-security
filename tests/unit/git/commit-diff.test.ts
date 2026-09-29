import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { simpleGit, type SimpleGit } from 'simple-git'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const repoDir = join(tmpdir(), `os-test-diff-${Date.now()}`)

// ── Fixture repo with known diff content ──────────────────────
let git: SimpleGit
let commitA: string
let commitB: string
let commitMerge: string

beforeAll(async () => {
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true })
  mkdirSync(repoDir, { recursive: true })

  git = simpleGit({ baseDir: repoDir })
  await git.init(['-b', 'main'])
  await git.addConfig('user.email', 'dev@diff.test')
  await git.addConfig('user.name', 'Diff Tester')

  // Commit A — single file
  writeFileSync(join(repoDir, 'hello.txt'), 'Hello\nWorld\n')
  await git.add('.')
  const a = await git.commit('A: hello')
  commitA = a.commit || ''

  // Commit B — multi-line addition
  writeFileSync(join(repoDir, 'hello.txt'), 'Hello\nBeautiful\nWorld\n')
  await git.add('.')
  const b = await git.commit('B: beautiful')
  commitB = b.commit || ''
})

afterAll(() => {
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true })
})

// ── Tests ─────────────────────────────────────────────────────

describe('getCommitDiff', () => {
  // RED PHASE: @/lib/git/commit-diff does not exist yet

  it('returns the diff content for a known commit', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    const result = await getCommitDiff(repoDir, commitA)

    expect(typeof result.diff).toBe('string')
    // diff should mention hello.txt
    expect(result.diff).toContain('hello.txt')
    // should show added lines with '+'
    expect(result.diff).toContain('+Hello')
  })

  it('returns the commit SHA in the result', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    const result = await getCommitDiff(repoDir, commitA)
    expect(result.sha).toBe(commitA)
  })

  it('shows insertions and deletions correctly for second commit', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    const result = await getCommitDiff(repoDir, commitB)

    // Commit B changed hello.txt: added "Beautiful", removed empty line
    expect(result.diff).toContain('+Beautiful')
    expect(result.diff).toContain('hello.txt')
  })

  it('accepts an optional pre-configured git client', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    const result = await getCommitDiff(repoDir, commitA, git)
    expect(result.diff).toContain('hello.txt')
  })

  it('throws for non-existent commit SHA', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    await expect(getCommitDiff(repoDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).rejects.toThrow()
  })

  it('diff for later commit includes changes from earlier commit context', async () => {
    const { getCommitDiff } = await import('@/lib/git/commit-diff')

    const result = await getCommitDiff(repoDir, commitB)
    // Should show both old lines and new lines in diff
    expect(result.diff).toContain('Hello')
    expect(result.diff).toContain('Beautiful')
  })
})
