/**
 * lib/watch/worktree.ts
 *
 * Manage git worktrees for watch mode delta scans.
 *
 * Worktree paths: ~/.obt/worktrees/{repoId}/{sha8(branch)}
 * Using sha8(branch) avoids case-sensitivity collisions on macOS HFS+ and
 * ensures the path is FS-safe regardless of branch name characters.
 *
 * All spawn calls use argv arrays — never shell interpolation.
 */
import * as cp from 'node:child_process'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { OBT_ROOT } from '@/lib/config/store'

const WORKTREES_ROOT = path.join(OBT_ROOT, 'worktrees')

/**
 * Compute a short hash of the branch name for FS-safe path derivation.
 *
 * @param branch - Branch name (may contain slashes and special chars)
 * @returns 8-character hex string
 */
function sha8(branch: string): string {
  return crypto.createHash('sha256').update(branch).digest('hex').slice(0, 8)
}

/**
 * Create a git worktree for a branch at a stable path under ~/.obt/worktrees.
 *
 * @param repoPath - Absolute path to the main git repository
 * @param branch - Branch name to check out in the worktree
 * @returns Absolute path to the created worktree
 * @throws If git worktree add fails
 */
export function createWorktree(repoPath: string, branch: string): string {
  const repoId = path.basename(repoPath)
  const worktreePath = path.join(WORKTREES_ROOT, repoId, sha8(branch))

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

  const result = cp.spawnSync(
    'git',
    ['worktree', 'add', worktreePath, branch],
    {
      cwd: repoPath,
      encoding: 'utf-8',
      shell: false,
    },
  )

  if (result.status !== 0 || result.signal !== null) {
    const errMsg = (result.stderr as string) || `exit code ${String(result.status)}`
    throw new Error(`git worktree add failed: ${errMsg}`)
  }

  return worktreePath
}

/**
 * Remove a git worktree (best-effort — does not throw on failure).
 *
 * @param worktreePath - Absolute path to the worktree to remove
 */
export function removeWorktree(worktreePath: string): void {
  // Use the parent repo's git — find it by walking up from worktreePath
  // or simply call git from a parent directory. We use the worktree's parent.
  const cwd = path.dirname(path.dirname(worktreePath))

  try {
    cp.spawnSync(
      'git',
      ['worktree', 'remove', '--force', worktreePath],
      {
        cwd,
        encoding: 'utf-8',
        shell: false,
      },
    )
    // Intentionally ignore exit code — best-effort cleanup
  } catch {
    // Ignore errors — worktree may already be removed
  }
}
