/**
 * lib/integrations/github/pr-comment.ts
 *
 * Post a structured findings summary as a PR comment on GitHub.
 * Idempotent: checks for an existing sentinel comment before posting.
 * Collapses lists of more than 10 findings inside a <details> block.
 *
 * Sentinel format: <!-- obt:scan:{scanId} -->
 */
import { githubFetch } from './client'
import type { FindingDeltaDTO } from '@/lib/repos/scans.repo'

const FINDINGS_COLLAPSE_THRESHOLD = 10

/**
 * Post a structured PR comment with open-security findings.
 *
 * Idempotent by sentinel tag: if a comment with the same scanId sentinel
 * already exists, this function is a no-op. If a comment for a different
 * scanId exists, it updates that comment with the new findings.
 *
 * @param owner - GitHub repo owner (e.g. 'acme')
 * @param repo - GitHub repo name (e.g. 'backend')
 * @param prNumber - Pull request number
 * @param findings - Delta findings to summarize
 * @param scanId - Scan ID used as idempotency sentinel
 */
export async function postPrComment(
  owner: string,
  repo: string,
  prNumber: number,
  findings: FindingDeltaDTO[],
  scanId: string,
): Promise<void> {
  const sentinel = `<!-- obt:scan:${scanId} -->`
  const commentsPath = `/repos/${owner}/${repo}/issues/${prNumber}/comments`

  // 1. List existing comments to check for sentinel
  const listRes = await githubFetch(commentsPath)
  if (!listRes.ok) {
    throw new Error(`GitHub API ${listRes.status}: failed to list PR comments`)
  }

  const comments = (await listRes.json()) as Array<{ id: number; body: string }>

  // Check for our sentinel in existing comments
  const ownSentinel = `<!-- obt:scan:${scanId} -->`
  const exactMatch = comments.find((c) => c.body.includes(ownSentinel))
  if (exactMatch) {
    // Exact same scan — already posted, no-op
    return
  }

  // Check for any open-security comment (different scan)
  const anyObtComment = comments.find((c) => c.body.includes('<!-- obt:scan:'))

  const body = formatComment(findings, sentinel)

  if (anyObtComment) {
    // Update existing comment with fresh findings
    const updatePath = `/repos/${owner}/${repo}/issues/comments/${anyObtComment.id}`
    const updateRes = await githubFetch(updatePath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!updateRes.ok) {
      const errText = await updateRes.text()
      throw new Error(`GitHub API ${updateRes.status}: ${errText}`)
    }
  } else {
    // Create new comment
    const createRes = await githubFetch(commentsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!createRes.ok) {
      const errText = await createRes.text()
      throw new Error(`GitHub API ${createRes.status}: ${errText}`)
    }
  }
}

/**
 * Format findings into a GitHub Markdown PR comment body.
 *
 * @param findings - Array of delta findings
 * @param sentinel - HTML comment sentinel for idempotency
 * @returns Markdown string suitable for a GitHub PR comment body
 */
function formatComment(findings: FindingDeltaDTO[], sentinel: string): string {
  const findingCount = findings.length
  const header = [
    sentinel,
    '## open-security findings',
    '',
    `**${findingCount} new finding${findingCount === 1 ? '' : 's'}** detected in this PR.`,
    '',
  ].join('\n')

  if (findingCount === 0) {
    return `${header}No new security findings detected.`
  }

  const rows = findings.map((f) =>
    `| ${severityBadge(f.severity)} | ${f.detector} | ${f.title} | \`${f.locationPath}:${f.locationLineStart}\` |`
  )

  const table = [
    '| Severity | Detector | Title | Location |',
    '|----------|----------|-------|----------|',
    ...rows,
  ].join('\n')

  if (findingCount > FINDINGS_COLLAPSE_THRESHOLD) {
    return [
      header,
      `<details>`,
      `<summary>${findingCount} findings — click to expand</summary>`,
      '',
      table,
      '',
      `</details>`,
    ].join('\n')
  }

  return `${header}${table}`
}

/**
 * Return a severity label for use in GitHub Markdown tables.
 *
 * @param severity - Raw severity string from the finding
 * @returns Uppercase severity string
 */
function severityBadge(severity: string): string {
  return severity.toUpperCase()
}
