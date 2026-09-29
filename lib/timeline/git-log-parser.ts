/**
 * lib/timeline/git-log-parser.ts
 *
 * Runs `git log -p -S` against a repository and parses the output to
 * produce a timeline of commits that introduced or removed a secret.
 */
import { spawn } from 'node:child_process'

/** A single commit entry in a secret's history. */
export interface CommitInfo {
  /** Full commit SHA. */
  hash: string
  /** Author display name. */
  author: string
  /** Author email address. */
  email: string
  /** ISO 8601 authored date. */
  date: string
  /** Whether the secret was added or removed in this commit. */
  action: 'introduce' | 'remove'
}

/** Result of a git log parse operation. */
export interface GitLogResult {
  /** Ordered list of commits that touched the secret. */
  commits: CommitInfo[]
  /**
   * True if the result is incomplete — e.g. because the 60s timeout was hit.
   * Callers should surface this to the user.
   */
  partial: boolean
}

const GIT_TIMEOUT_MS = 60_000

/**
 * Regex to match a commit header line produced by
 * `--format=format:'%H|%an|%ae|%aI'`.
 *
 * Example: `abc123|Alice Smith|alice@example.com|2024-01-15T10:30:00+00:00`
 */
const HEADER_RE = /^([0-9a-f]{6,})\|(.+?)\|(.+?@.+?)\|(.+)$/

/**
 * Parses git log output into an ordered list of `CommitInfo` records.
 *
 * @internal Exported for unit testing.
 * @param raw - Raw stdout from `git log -p --format=format:%H|%an|%ae|%aI`.
 *
 * Each commit block starts with a header line matching `HEADER_RE`.
 * The diff hunks that follow determine whether the secret was introduced
 * (first `+` line in a hunk) or removed (first `-` line in a hunk).
 */
export function parseOutput(raw: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  let current: Omit<CommitInfo, 'action'> | null = null
  let hasAddition = false
  let hasDeletion = false

  function flush(): void {
    if (current !== null) {
      const action: 'introduce' | 'remove' = hasDeletion && !hasAddition ? 'remove' : 'introduce'
      commits.push({ ...current, action })
      current = null
      hasAddition = false
      hasDeletion = false
    }
  }

  for (const line of raw.split('\n')) {
    const headerMatch = HEADER_RE.exec(line)
    if (headerMatch) {
      flush()
      current = {
        hash: headerMatch[1],
        author: headerMatch[2],
        email: headerMatch[3],
        date: headerMatch[4],
      }
      continue
    }

    if (current !== null) {
      // Detect diff hunk content: lines starting with + or - (but not +++ or ---)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        hasAddition = true
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        hasDeletion = true
      }
    }
  }

  flush()
  return commits
}

/**
 * Runs `git log -p -S '<secretHash>'` against a repository and returns
 * a structured list of commits that introduced or removed the secret.
 *
 * Uses a 60-second AbortSignal timeout. If the process is terminated before
 * completing, `partial: true` is returned along with any commits parsed so far.
 *
 * @param repoPath - Absolute path to the git repository.
 * @param secretHash - The search string to pass to `git log -S`.
 * @param filePath - Optional: limit the search to a specific file path.
 * @returns An object with the parsed commits and a `partial` flag.
 */
export async function parseGitLog(
  repoPath: string,
  secretHash: string,
  filePath?: string,
): Promise<GitLogResult> {
  return new Promise<GitLogResult>((resolve) => {
    const args = [
      'log',
      '-p',
      `-S${secretHash}`,
      '--all',
      '--no-merges',
      '--format=format:%H|%an|%ae|%aI',
    ]

    if (filePath) {
      args.push('--', filePath)
    }

    const child = spawn('git', args, {
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, GIT_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.once('close', (code: number | null) => {
      clearTimeout(timer)
      // Non-zero exit: 143 = SIGTERM, 137 = SIGKILL, 1 = general error
      const wasKilled = code !== 0 && code !== null
      const commits = parseOutput(stdout)
      resolve({ commits, partial: wasKilled })
    })

    child.once('error', () => {
      clearTimeout(timer)
      resolve({ commits: [], partial: false })
    })
  })
}
