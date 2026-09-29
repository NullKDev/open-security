import { simpleGit, type SimpleGit } from 'simple-git'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertUnder } from '@/lib/security/path-guard'

// Accept: gitlab.com, gitlab subdomain (e.g. gitlab.internal.company.com),
// and any self-managed instance with /group/project.git path structure
const GITLAB_URL_PATTERN = /^https?:\/\/([^/]+\.)?gitlab\.[^/]+\/[^/]+\/[^/]+(?:\.git)?\/?$/i

/**
 * Clones a GitLab repository into a workspace.
 *
 * @param repoUrl - HTTPS URL of the GitLab repo (e.g. https://gitlab.com/group/project.git)
 * @param destPath - Target local path for the clone
 * @param workspaceRoot - Approved workspace root for path-guard
 * @param pat - Optional GitLab Personal Access Token (injected via env, NEVER shell string)
 * @returns The resolved destination path
 */
export async function cloneGitLabRepo(
  repoUrl: string,
  destPath: string,
  workspaceRoot: string,
  pat?: string,
): Promise<string> {
  // 1. Validate GitLab URL format
  const normalizedUrl = repoUrl.trim().replace(/\/$/, '')
  if (!GITLAB_URL_PATTERN.test(normalizedUrl)) {
    throw new Error(`Invalid GitLab URL or unsupported host: ${repoUrl}`)
  }

  // 2. Reject PAT in the URL itself
  if (/https?:\/\/[^:@]+:[^@]+@/.test(repoUrl)) {
    throw new Error('Credentials detected in URL. PAT must be injected via environment, not shell string.')
  }

  // 3. Path-guard: ensure dest is under workspace root
  assertUnder(workspaceRoot, destPath)

  // 4. Resolve dest and prepare parent directory
  const resolvedDest = path.resolve(destPath)
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true })

  // 5. Configure git with env-based PAT if provided
  if (pat) {
    const askpassPath = path.join(os.tmpdir(), `.git-askpass-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const askpassScript = `#!/bin/sh\necho "${pat}"`
    fs.writeFileSync(askpassPath, askpassScript, { mode: 0o700 })

    try {
      const git: SimpleGit = simpleGit({ baseDir: path.dirname(resolvedDest) })
        .env('GIT_ASKPASS', askpassPath)
        .env('GIT_TERMINAL_PROMPT', '0')

      await git.clone(repoUrl, resolvedDest, ['--single-branch'])
    } finally {
      try { fs.unlinkSync(askpassPath) } catch { /* best effort */ }
    }
  } else {
    const git: SimpleGit = simpleGit({ baseDir: path.dirname(resolvedDest) })
    await git.clone(repoUrl, resolvedDest, ['--single-branch'])
  }

  return resolvedDest
}
