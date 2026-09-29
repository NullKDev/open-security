import { simpleGit, type SimpleGit } from 'simple-git'

/** Commit information yielded by the history walker */
export interface CommitInfo {
  hash: string
  message: string
  author: string
  authorEmail: string
  date: string
  filesChanged: number
  insertions: number
  deletions: number
}

/**
 * Walk the full git commit history of a repository.
 *
 * Yields commits in reverse chronological order (newest first).
 * Uses `git log --all --full-history --numstat` for completeness.
 * Designed as an async generator for memory efficiency on large repos.
 *
 * @param repoPath - Path to the git repository (must contain a .git directory)
 * @param gitClient - Optional pre-configured simple-git instance (for testing)
 */
export async function* walkHistory(
  repoPath: string,
  gitClient?: SimpleGit,
): AsyncGenerator<CommitInfo> {
  const git = gitClient ?? simpleGit({ baseDir: repoPath })

  const log = await git.log({
    '--all': null,
    '--full-history': null,
    '--numstat': null,
  })

  for (const entry of log.all) {
    const diff = entry.diff as { files?: Array<{ file: string; changes: number; insertions: number; deletions: number }> } | undefined

    let filesChanged = 0
    let insertions = 0
    let deletions = 0

    if (diff?.files) {
      filesChanged = diff.files.length
      insertions = diff.files.reduce((sum, f) => sum + (f.insertions || 0), 0)
      deletions = diff.files.reduce((sum, f) => sum + (f.deletions || 0), 0)
    }

    yield {
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: entry.date,
      filesChanged,
      insertions,
      deletions,
    }
  }
}
