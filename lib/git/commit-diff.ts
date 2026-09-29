import { simpleGit, type SimpleGit } from 'simple-git'

/** Result from getCommitDiff */
export interface CommitDiffResult {
  sha: string
  diff: string
}

/**
 * Lazily fetch the full diff content for a single commit.
 *
 * Uses `git show <sha>` which returns the commit metadata + full diff.
 * This is intentionally lazy (not called during the walk) to keep the
 * walker lightweight for large repos.
 *
 * @param repoPath - Path to the git repository
 * @param sha - Full commit hash
 * @param gitClient - Optional pre-configured simple-git instance
 * @returns CommitDiffResult with sha and full diff text
 * @throws If the commit SHA does not exist
 */
export async function getCommitDiff(
  repoPath: string,
  sha: string,
  gitClient?: SimpleGit,
): Promise<CommitDiffResult> {
  const git = gitClient ?? simpleGit({ baseDir: repoPath })

  const diff = await git.show([sha])

  return {
    sha,
    diff,
  }
}
