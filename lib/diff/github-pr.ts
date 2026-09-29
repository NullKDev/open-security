/**
 * lib/diff/github-pr.ts
 *
 * Fetch the list of changed files for a GitHub Pull Request using the GitHub
 * REST API. Handles pagination and enforces a hard cap of 3000 files per PR.
 *
 * Uses native fetch — no Octokit dependency.
 */

/** Maximum number of files to fetch from a PR (API cap is 3000 per PR). */
const MAX_FILES = 3000

/** GitHub REST API files-per-page maximum. */
const PER_PAGE = 100

interface GithubPrFile {
  filename: string
  status: string
}

interface GetPrChangedFilesOpts {
  /** Repository owner (org or user). */
  owner: string
  /** Repository name. */
  repo: string
  /** Pull request number. */
  prNumber: number
  /** GitHub Personal Access Token for authentication. */
  token: string
}

/**
 * Extract the URL of the next page from a GitHub Link header.
 * Returns null if there is no next page.
 */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  // GitHub Link header format: <url>; rel="next", <url>; rel="last"
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

/**
 * Fetch the list of changed file paths for a GitHub Pull Request.
 *
 * Paginates through all pages automatically. Stops at {@link MAX_FILES} to
 * prevent memory exhaustion on very large PRs.
 *
 * @param opts.owner - Repository owner (org or user login)
 * @param opts.repo - Repository name
 * @param opts.prNumber - Pull request number
 * @param opts.token - GitHub PAT for authentication (Bearer scheme)
 * @returns Array of changed file paths (relative to repo root)
 * @throws Error with HTTP status if the API returns a non-2xx response
 */
export async function getPrChangedFiles(opts: GetPrChangedFilesOpts): Promise<string[]> {
  const { owner, repo, prNumber, token } = opts
  const allFiles: string[] = []

  let url: string | null =
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=${PER_PAGE}`

  while (url !== null && allFiles.length < MAX_FILES) {
    const response = await fetch(url, { // user-webhook-fetch — GitHub API, user-supplied token
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'open-security/v0.2',
      },
    })

    if (!response.ok) {
      throw new Error(
        `GitHub API error ${response.status} fetching PR #${prNumber} files for ${owner}/${repo}`,
      )
    }

    const files = (await response.json()) as GithubPrFile[]
    for (const file of files) {
      if (allFiles.length >= MAX_FILES) break
      allFiles.push(file.filename)
    }

    // Check for next page
    const linkHeader = response.headers.get('Link')
    url = parseNextLink(linkHeader)
  }

  return allFiles
}
