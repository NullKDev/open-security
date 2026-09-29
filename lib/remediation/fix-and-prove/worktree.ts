/**
 * worktree.ts — Git worktree management for the Fix & Prove triad
 *
 * Creates and removes per-finding git worktrees used by the PatchEval triad.
 * The worktree is located at `.obt/projects/{projectId}/scans/{scanId}/proofs/{findingId}/`
 * as per ADR-2 (design.md §2).
 *
 * Design constraints:
 * - All git commands use runGitCommand (spawn in argv form — no shell)
 * - applyPatch/revertPatch write a temp file and pass it to git apply
 * - 30s timeout for all git operations
 * - pruneStale is idempotent and safe to call at boot
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { runGitCommand } from '@/lib/remediation/git-ops'
import type { OpResult } from '@/lib/remediation/git-ops'
import { scanDir } from '@/lib/config/workspace'

const GIT_TIMEOUT_MS = 30_000

// ─── Path helpers ──────────────────────────────────────────────────────────

/**
 * Returns the canonical path for a per-finding proof worktree.
 * Lives at `.obt/projects/{projectId}/scans/{scanId}/proofs/{findingId}/`
 *
 * @param projectId - The project owning this scan
 * @param scanId - The scan the finding belongs to
 * @param findingId - The finding being proved
 * @param root - Optional OBT root override (for testing)
 * @returns Absolute path to the proof worktree directory
 */
export function proofWorktreePath(
  projectId: string,
  scanId: string,
  findingId: string,
  root?: string,
): string {
  const base = scanDir(projectId, scanId, root)
  return path.join(base, 'proofs', findingId)
}

// ─── Worktree lifecycle ────────────────────────────────────────────────────

/**
 * Creates a dedicated git worktree at the proof path, checked out at the
 * given commit SHA. This is an isolated copy — the operator's fix branch
 * (v0.1) is never touched.
 *
 * @param srcDir - The repository source directory (where `.git` lives)
 * @param projectId - The project ID (used to build the worktree path)
 * @param scanId - The scan ID (used to build the worktree path)
 * @param findingId - The finding ID (used to build the worktree path)
 * @param commit - Git commit SHA to check out in the new worktree
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function createWorktree(
  srcDir: string,
  projectId: string,
  scanId: string,
  findingId: string,
  commit: string,
): Promise<OpResult> {
  const worktreePath = proofWorktreePath(projectId, scanId, findingId)

  const result = await runGitCommand(
    srcDir,
    ['worktree', 'add', '--detach', worktreePath, commit],
    GIT_TIMEOUT_MS,
  )

  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || `git worktree add exited with code ${result.code}`,
    }
  }

  return { ok: true }
}

/**
 * Removes a proof worktree using `git worktree remove --force`.
 * Always called in a `finally` block — must never throw.
 *
 * @param srcDir - The repository source directory
 * @param projectId - The project ID
 * @param scanId - The scan ID
 * @param findingId - The finding ID
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function removeWorktree(
  srcDir: string,
  projectId: string,
  scanId: string,
  findingId: string,
): Promise<OpResult> {
  const worktreePath = proofWorktreePath(projectId, scanId, findingId)

  const result = await runGitCommand(
    srcDir,
    ['worktree', 'remove', '--force', worktreePath],
    GIT_TIMEOUT_MS,
  )

  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || `git worktree remove exited with code ${result.code}`,
    }
  }

  return { ok: true }
}

// ─── Patch application ─────────────────────────────────────────────────────

/**
 * Writes `patchDiff` to a temp file and applies it in `cwd` via `git apply`.
 * Runs `--check` first to validate before mutating the tree.
 *
 * @param cwd - The worktree directory where the patch should be applied
 * @param patchDiff - Unified diff content
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function applyPatch(cwd: string, patchDiff: string): Promise<OpResult> {
  const tmpFile = path.join(os.tmpdir(), `obt-wt-patch-${Date.now()}.diff`)

  try {
    fs.writeFileSync(tmpFile, patchDiff, 'utf-8')

    // Validate first
    const checkResult = await runGitCommand(
      cwd,
      ['apply', '--check', tmpFile],
      GIT_TIMEOUT_MS,
    )

    if (checkResult.code !== 0) {
      return {
        ok: false,
        error: checkResult.stderr || `git apply --check exited with code ${checkResult.code}`,
      }
    }

    // Apply the patch
    const applyResult = await runGitCommand(cwd, ['apply', tmpFile], GIT_TIMEOUT_MS)

    if (applyResult.code !== 0) {
      return {
        ok: false,
        error: applyResult.stderr || `git apply exited with code ${applyResult.code}`,
      }
    }

    return { ok: true }
  } finally {
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      // Best-effort cleanup — ignore if already removed
    }
  }
}

/**
 * Reverts a previously applied patch by running `git apply -R`.
 * Used by the triad to pivot from "patched" state back to "pre-patch" state
 * so the regression test can be run against the unpatched code.
 *
 * @param cwd - The worktree directory where the patch should be reverted
 * @param patchDiff - Unified diff content (same diff that was applied)
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function revertPatch(cwd: string, patchDiff: string): Promise<OpResult> {
  const tmpFile = path.join(os.tmpdir(), `obt-wt-revert-${Date.now()}.diff`)

  try {
    fs.writeFileSync(tmpFile, patchDiff, 'utf-8')

    const result = await runGitCommand(cwd, ['apply', '-R', tmpFile], GIT_TIMEOUT_MS)

    if (result.code !== 0) {
      return {
        ok: false,
        error: result.stderr || `git apply -R exited with code ${result.code}`,
      }
    }

    return { ok: true }
  } finally {
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      // Best-effort cleanup — ignore if already removed
    }
  }
}

// ─── Stale cleanup ─────────────────────────────────────────────────────────

/**
 * Runs `git worktree prune` on the source repository to evict any orphaned
 * worktrees left by a previous crash. Safe to call at boot — idempotent.
 *
 * @param srcDir - The repository source directory
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function pruneStale(srcDir: string): Promise<OpResult> {
  const result = await runGitCommand(srcDir, ['worktree', 'prune'], GIT_TIMEOUT_MS)

  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || `git worktree prune exited with code ${result.code}`,
    }
  }

  return { ok: true }
}
