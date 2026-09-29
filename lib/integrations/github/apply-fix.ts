/**
 * lib/integrations/github/apply-fix.ts
 *
 * Apply a patch diff to a file on a GitHub PR branch by creating a new commit.
 *
 * Flow:
 *  1. GET /repos/{owner}/{repo}/contents/{path}?ref={branch} — fetch current file + SHA
 *  2. Apply the patchDiff locally in memory
 *  3. PUT /repos/{owner}/{repo}/contents/{path} with base64-encoded new content + parent SHA
 *
 * Handles:
 *  - 409 from GitHub: throws with "409:" prefix so callers can detect merge conflicts
 *  - Missing file: propagates the 404 as an error
 */
import { githubFetch } from './client'

/**
 * Apply a patch diff to a file on a PR branch and create a commit.
 *
 * @param owner - GitHub repo owner
 * @param repo - GitHub repo name
 * @param branch - Branch name to commit to (typically the PR head branch)
 * @param filePath - Repo-relative file path to patch (e.g. 'src/auth.ts')
 * @param patchDiff - Unified diff string produced by Stage 5
 * @param commitMessage - Commit message for the fix commit
 * @throws On 409 (merge conflict), 404 (file not found), or other GitHub API errors
 */
export async function applyFixToPr(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  patchDiff: string,
  commitMessage = 'fix: apply open-security suggested fix',
): Promise<void> {
  // 1. Fetch current file content and SHA
  const contentsPath = `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`
  const getRes = await githubFetch(contentsPath) // github-api-fetch

  if (!getRes.ok) {
    if (getRes.status === 409) {
      throw new Error(`409: Merge conflict fetching ${filePath} on branch ${branch}`)
    }
    const errText = await getRes.text()
    throw new Error(`GitHub API ${getRes.status} fetching file: ${errText}`)
  }

  const fileData = (await getRes.json()) as {
    content: string
    sha: string
    encoding: string
  }

  if (fileData.encoding !== 'base64') {
    throw new Error(`Unexpected file encoding: ${fileData.encoding}`)
  }

  // Decode current file content
  const currentContent = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  const parentSha = fileData.sha

  // 2. Apply patch in memory
  const newContent = applyUnifiedDiff(currentContent, patchDiff)

  // 3. Encode and commit
  const encoded = Buffer.from(newContent, 'utf-8').toString('base64')
  const putPath = `/repos/${owner}/${repo}/contents/${filePath}`

  const putRes = await githubFetch(putPath, { // github-api-fetch
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: commitMessage,
      content: encoded,
      sha: parentSha,
      branch,
    }),
  })

  if (!putRes.ok) {
    if (putRes.status === 409) {
      throw new Error(`409: Merge conflict committing ${filePath} on branch ${branch}`)
    }
    const errText = await putRes.text()
    throw new Error(`GitHub API ${putRes.status} committing file: ${errText}`)
  }
}

/**
 * Apply a unified diff string to file content.
 *
 * Simple line-based diff application for the unified diff format produced
 * by Stage 5 patches. Handles standard context/addition/deletion hunks.
 *
 * @param original - Original file content (UTF-8 string)
 * @param diff - Unified diff string
 * @returns Patched file content
 */
function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = original.split('\n')
  const diffLines = diff.split('\n')

  const result: string[] = []
  let origIdx = 0

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i]

    // Skip diff headers
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
      continue
    }

    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -startLine,count +startLine,count @@
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match) {
        const origStart = parseInt(match[1], 10) - 1
        // Emit unchanged lines up to hunk start
        while (origIdx < origStart) {
          if (origIdx < originalLines.length) {
            result.push(originalLines[origIdx])
          }
          origIdx++
        }
      }
      continue
    }

    if (line.startsWith('+')) {
      // Added line — include in output
      result.push(line.slice(1))
    } else if (line.startsWith('-')) {
      // Removed line — skip original, advance origIdx
      origIdx++
    } else if (line.startsWith(' ') || line === '') {
      // Context line — copy from original
      if (origIdx < originalLines.length) {
        result.push(originalLines[origIdx])
      }
      origIdx++
    }
  }

  // Emit remaining original lines after last hunk
  while (origIdx < originalLines.length) {
    result.push(originalLines[origIdx])
    origIdx++
  }

  return result.join('\n')
}
