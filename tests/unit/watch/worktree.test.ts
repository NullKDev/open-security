/**
 * tests/unit/watch/worktree.test.ts
 *
 * TDD: T-H04 — worktree management
 * Tests: createWorktree returns path, removeWorktree calls git, error handling.
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as cp from 'node:child_process'

// ─── Mock child_process ───────────────────────────────────────────────────────
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>()
  return { ...mod, spawnSync: vi.fn() }
})

import { createWorktree, removeWorktree } from '@/lib/watch/worktree'

const REPO_PATH = '/home/user/my-repo'
const BRANCH = 'feature/auth'

describe('createWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls git worktree add with argv array (no shell interpolation)', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: null,
    })

    const result = createWorktree(REPO_PATH, BRANCH)

    expect(vi.mocked(cp.spawnSync)).toHaveBeenCalledOnce()
    const [cmd, args, opts] = vi.mocked(cp.spawnSync).mock.calls[0]
    expect(cmd).toBe('git')
    expect(args).toContain('worktree')
    expect(args).toContain('add')
    // Must NOT pass branch with shell interpolation — the branch name should be
    // a separate argv element, not embedded in a string
    expect(args).toContain(BRANCH)
    expect(opts?.shell).toBeFalsy()

    // Returns the worktree path
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('includes branch name in the worktree path (sha8 of branch for FS safety)', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''),
      pid: 1, output: [], signal: null,
    })

    const path1 = createWorktree(REPO_PATH, 'main')
    const path2 = createWorktree(REPO_PATH, 'feature/other')

    // Paths must differ — branch is encoded in path
    expect(path1).not.toBe(path2)
  })

  it('throws when git command fails', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from('fatal: branch already checked out'),
      pid: 1,
      output: [],
      signal: null,
    })

    expect(() => createWorktree(REPO_PATH, BRANCH)).toThrow(/worktree|git/i)
  })

  it('throws when spawnSync returns null status (signal kill)', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: null,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: 'SIGKILL',
    })

    expect(() => createWorktree(REPO_PATH, BRANCH)).toThrow()
  })
})

describe('removeWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls git worktree remove with force flag', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''),
      pid: 1, output: [], signal: null,
    })

    const worktreePath = '/tmp/worktrees/repo/abc'
    removeWorktree(worktreePath)

    const [cmd, args] = vi.mocked(cp.spawnSync).mock.calls[0]
    expect(cmd).toBe('git')
    expect(args).toContain('worktree')
    expect(args).toContain('remove')
    expect(args).toContain('--force')
    expect(args).toContain(worktreePath)
  })

  it('does not throw when git worktree remove fails (best-effort cleanup)', () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 1, stdout: Buffer.from(''), stderr: Buffer.from('not a worktree'),
      pid: 1, output: [], signal: null,
    })

    expect(() => removeWorktree('/tmp/missing-worktree')).not.toThrow()
  })
})
