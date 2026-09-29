import { simpleGit, type SimpleGit } from 'simple-git'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertUnder } from '@/lib/security/path-guard'

const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/

/**
 * Clones a GitHub repository into a workspace.
 *
 * @param repoUrl - HTTPS URL of the GitHub repo (e.g. https://github.com/owner/repo.git)
 * @param destPath - Target local path for the clone
 * @param workspaceRoot - Approved workspace root for path-guard
 * @param pat - Optional GitHub Personal Access Token (injected via env, NEVER shell string)
 * @returns The resolved destination path
 */
export async function cloneGitHubRepo(
  repoUrl: string,
  destPath: string,
  workspaceRoot: string,
  pat?: string,
): Promise<string> {
  // 1. Validate GitHub URL format — reject non-GitHub hosts
  const normalizedUrl = repoUrl.trim().replace(/\/$/, '')
  if (!GITHUB_URL_PATTERN.test(normalizedUrl)) {
    throw new Error(`Invalid GitHub URL or unsupported host: ${repoUrl}`)
  }

  // 2. Reject PAT in the URL itself (security invariant)
  if (repoUrl.includes('@') && !repoUrl.startsWith('https://')) {
    // Detect token in URL — anything before @ is credentials
    throw new Error(`PAT must not appear in the URL. Use the pat parameter to inject via env.`)
  }

  // Explicitly check for common credential patterns in URL
  if (/https?:\/\/[^:@]+:[^@]+@/.test(repoUrl)) {
    throw new Error('Credentials detected in URL. PAT must be injected via environment, not shell string.')
  }

  // 3. Path-guard: ensure dest is under workspace root
  assertUnder(workspaceRoot, destPath)

  // 4. Resolve dest and prepare parent directory
  const resolvedDest = path.resolve(destPath)
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true })

  // 5. Configure git with env-based PAT if provided
  let git: SimpleGit

  if (pat) {
    // Write an askpass script that echoes the token.
    // GIT_ASKPASS + credential helper ensures the token NEVER appears in argv.
    const askpassPath = path.join(os.tmpdir(), `.git-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const askpassScript = `#!/bin/sh\necho "${pat}"`
    fs.writeFileSync(askpassPath, askpassScript, { mode: 0o700 })

    try {
      git = simpleGit({ baseDir: path.dirname(resolvedDest) })
        .env('GIT_ASKPASS', askpassPath)
        .env('GIT_TERMINAL_PROMPT', '0')

      await git.clone(repoUrl, resolvedDest, ['--single-branch'])
    } finally {
      // Clean up the askpass script immediately
      try { fs.unlinkSync(askpassPath) } catch { /* best effort */ }
    }
  } else {
    git = simpleGit({ baseDir: path.dirname(resolvedDest) })
    await git.clone(repoUrl, resolvedDest, ['--single-branch'])
  }

  return resolvedDest
}
