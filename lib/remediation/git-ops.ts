/**
 * git-ops.ts — Low-level git operations for branch remediation
 *
 * All git commands use child_process.spawn in argv form (no shell).
 * This prevents shell injection — the branch name, commit ref, and patch
 * content never touch a shell interpreter.
 *
 * Design constraints (Design §5):
 * - spawn in argv form, never `exec` or `{shell: true}`
 * - 30s timeout for git operations
 * - applyPatch: writes patch to temp file, runs --check then apply
 */
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

export interface OpResult {
  ok: boolean
  error?: string
}

/**
 * Derives the fix branch name from a finding ID.
 * Format: `sec/fix/<first-8-chars-of-findingId>`
 *
 * @param findingId - The UUID of the finding
 * @returns Branch name string (e.g. "sec/fix/abcdef12")
 */
export function buildBranchName(findingId: string): string {
  return `sec/fix/${findingId.slice(0, 8)}`
}

/**
 * Runs a git command in the given directory using `spawn` in argv form.
 * Never uses a shell — args must be an array.
 *
 * @param cwd - Working directory (the repo root)
 * @param args - Git arguments array (e.g. ['checkout', '-b', 'sec/fix/abc'])
 * @param timeoutMs - Milliseconds before the process is killed
 * @returns GitResult with exit code, stdout, and stderr
 */
export function runGitCommand(
  cwd: string,
  args: string[],
  timeoutMs: number,
): Promise<GitResult> {
  return new Promise((resolve) => {
    const proc = childProcess.spawn('git', args, {
      cwd,
      shell: false,
      timeout: timeoutMs,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}` },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message })
    })

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

const GIT_TIMEOUT_MS = 30_000

/**
 * Creates a new branch at a specific commit using `git checkout -b`.
 *
 * @param cwd - Repository working directory
 * @param branchRef - Name of the branch to create (e.g. "sec/fix/abcdef12")
 * @param scanCommit - Git commit SHA to base the branch on
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function checkoutBranch(
  cwd: string,
  branchRef: string,
  scanCommit: string,
): Promise<OpResult> {
  const result = await runGitCommand(
    cwd,
    ['checkout', '-b', branchRef, scanCommit],
    GIT_TIMEOUT_MS,
  )

  if (result.code !== 0) {
    return { ok: false, error: result.stderr || `git checkout exited with code ${result.code}` }
  }

  return { ok: true }
}

/**
 * Validates and applies a patch diff to the working directory.
 *
 * Steps:
 * 1. Write patchDiff content to a temp file
 * 2. Run `git apply --check <tmpfile>` to validate
 * 3. If valid, run `git apply <tmpfile>` to apply
 * 4. Clean up the temp file
 *
 * @param cwd - Repository working directory
 * @param patchDiff - Unified diff content to apply
 * @returns OpResult with ok:true on success or ok:false with error string
 */
export async function applyPatch(cwd: string, patchDiff: string): Promise<OpResult> {
  const tmpFile = path.join(os.tmpdir(), `obt-patch-${Date.now()}.diff`)

  try {
    fs.writeFileSync(tmpFile, patchDiff, 'utf-8')

    // Validate first
    const checkResult = await runGitCommand(cwd, ['apply', '--check', tmpFile], GIT_TIMEOUT_MS)

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
 * Resolves the HEAD commit SHA in the given directory.
 * Used when no scan commit is stored on the finding.
 *
 * @param cwd - Repository working directory
 * @returns The HEAD commit SHA string, or null on failure
 */
export async function resolveHeadCommit(cwd: string): Promise<string | null> {
  const result = await runGitCommand(cwd, ['rev-parse', 'HEAD'], GIT_TIMEOUT_MS)
  if (result.code !== 0) return null
  return result.stdout.trim() || null
}
