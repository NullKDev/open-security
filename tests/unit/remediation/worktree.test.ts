/**
 * tests/unit/remediation/worktree.test.ts
 *
 * TDD: T-012 (RED) + T-013 (GREEN) — worktree.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the worktree module which manages per-finding git worktrees
 * for the Fix & Prove triad (ADR-2 in design.md).
 *
 * All git/fs operations are mocked — this tests the orchestration logic only.
 * The path helpers from lib/config/workspace.ts are used to derive worktree paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks MUST be declared before imports ─────────────────────────────────
vi.mock('@/lib/remediation/git-ops', () => ({
  runGitCommand: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(),
  }
})

import { runGitCommand } from '@/lib/remediation/git-ops'
import type { GitResult } from '@/lib/remediation/git-ops'
import {
  createWorktree,
  removeWorktree,
  applyPatch,
  revertPatch,
  pruneStale,
  proofWorktreePath,
} from '@/lib/remediation/fix-and-prove/worktree'

const mockRunGit = vi.mocked(runGitCommand)

/** Default success result */
const OK: GitResult = { code: 0, stdout: '', stderr: '' }
/** Default failure result */
const FAIL: GitResult = { code: 1, stdout: '', stderr: 'git error' }

describe('worktree', () => {
  const projectId = 'proj-abc'
  const scanId = 'scan-xyz'
  const findingId = 'finding-1234-5678-abcd-ef01'
  const srcDir = '/repos/myproject'
  const commit = 'deadbeef'

  beforeEach(() => {
    vi.clearAllMocks()
    mockRunGit.mockResolvedValue(OK)
  })

  // ─── proofWorktreePath ──────────────────────────────────────────────────────

  describe('proofWorktreePath', () => {
    it('returns path under .obt/projects/{projectId}/scans/{scanId}/proofs/{findingId}', () => {
      const p = proofWorktreePath(projectId, scanId, findingId)
      expect(p).toContain('projects')
      expect(p).toContain(projectId)
      expect(p).toContain('scans')
      expect(p).toContain(scanId)
      expect(p).toContain('proofs')
      expect(p).toContain(findingId)
    })

    it('is consistent — same args return same path', () => {
      expect(proofWorktreePath(projectId, scanId, findingId)).toBe(
        proofWorktreePath(projectId, scanId, findingId),
      )
    })
  })

  // ─── createWorktree ────────────────────────────────────────────────────────

  describe('createWorktree', () => {
    it('calls git worktree add with commit SHA', async () => {
      await createWorktree(srcDir, projectId, scanId, findingId, commit)

      expect(mockRunGit).toHaveBeenCalledWith(
        srcDir,
        expect.arrayContaining(['worktree', 'add']),
        expect.any(Number),
      )
    })

    it('returns ok:true on success', async () => {
      const result = await createWorktree(srcDir, projectId, scanId, findingId, commit)
      expect(result.ok).toBe(true)
    })

    it('returns ok:false with error message when git fails', async () => {
      mockRunGit.mockResolvedValue({ code: 128, stdout: '', stderr: 'fatal: worktree exists' })

      const result = await createWorktree(srcDir, projectId, scanId, findingId, commit)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('worktree exists')
    })

    it('includes the commit SHA in the git call args', async () => {
      await createWorktree(srcDir, projectId, scanId, findingId, commit)
      const args = mockRunGit.mock.calls[0][1]
      expect(args).toContain(commit)
    })

    it('includes the proof worktree path in the git call args', async () => {
      await createWorktree(srcDir, projectId, scanId, findingId, commit)
      const args = mockRunGit.mock.calls[0][1]
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      expect(args.some((a) => a.includes(findingId))).toBe(true)
      expect(args.some((a) => a === worktreePath || a.includes('proofs'))).toBe(true)
    })
  })

  // ─── removeWorktree ────────────────────────────────────────────────────────

  describe('removeWorktree', () => {
    it('calls git worktree remove --force', async () => {
      await removeWorktree(srcDir, projectId, scanId, findingId)

      expect(mockRunGit).toHaveBeenCalledWith(
        srcDir,
        expect.arrayContaining(['worktree', 'remove', '--force']),
        expect.any(Number),
      )
    })

    it('returns ok:true on success', async () => {
      const result = await removeWorktree(srcDir, projectId, scanId, findingId)
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when git fails', async () => {
      mockRunGit.mockResolvedValue(FAIL)
      const result = await removeWorktree(srcDir, projectId, scanId, findingId)
      expect(result.ok).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  // ─── applyPatch ────────────────────────────────────────────────────────────

  describe('applyPatch', () => {
    it('calls git apply in the worktree directory', async () => {
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      await applyPatch(worktreePath, 'diff --git a/f b/f\n+fix')

      expect(mockRunGit).toHaveBeenCalledWith(
        worktreePath,
        expect.arrayContaining(['apply']),
        expect.any(Number),
      )
    })

    it('returns ok:true on success', async () => {
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      const result = await applyPatch(worktreePath, 'diff text')
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when apply fails', async () => {
      mockRunGit.mockResolvedValue({ code: 1, stdout: '', stderr: 'patch does not apply' })
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      const result = await applyPatch(worktreePath, 'bad patch')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('patch does not apply')
    })
  })

  // ─── revertPatch ───────────────────────────────────────────────────────────

  describe('revertPatch', () => {
    it('calls git apply -R in the worktree directory', async () => {
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      await revertPatch(worktreePath, 'diff --git a/f b/f\n+fix')

      expect(mockRunGit).toHaveBeenCalledWith(
        worktreePath,
        expect.arrayContaining(['apply', '-R']),
        expect.any(Number),
      )
    })

    it('returns ok:true on success', async () => {
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      const result = await revertPatch(worktreePath, 'diff text')
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when revert fails', async () => {
      mockRunGit.mockResolvedValue({ code: 1, stdout: '', stderr: 'cannot revert' })
      const worktreePath = proofWorktreePath(projectId, scanId, findingId)
      const result = await revertPatch(worktreePath, 'bad patch')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('cannot revert')
    })
  })

  // ─── pruneStale ────────────────────────────────────────────────────────────

  describe('pruneStale', () => {
    it('calls git worktree prune in the source directory', async () => {
      await pruneStale(srcDir)

      expect(mockRunGit).toHaveBeenCalledWith(
        srcDir,
        expect.arrayContaining(['worktree', 'prune']),
        expect.any(Number),
      )
    })

    it('returns ok:true when prune succeeds', async () => {
      const result = await pruneStale(srcDir)
      expect(result.ok).toBe(true)
    })

    it('returns ok:false when prune fails', async () => {
      mockRunGit.mockResolvedValue(FAIL)
      const result = await pruneStale(srcDir)
      expect(result.ok).toBe(false)
    })
  })
})
