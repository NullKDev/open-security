/**
 * lib/exporters/github-code-scanning.ts
 *
 * Upload a scan's findings to GitHub Code Scanning as a SARIF 2.1.0 report.
 *
 * Credentials (all required):
 *   OBT_GITHUB_PAT    — Personal Access Token with `security_events` scope
 *   OBT_GITHUB_OWNER  — Repository owner (user or org)
 *   OBT_GITHUB_REPO   — Repository name
 *
 * Process:
 *   1. Query all findings for the scan
 *   2. Serialize to SARIF 2.1.0
 *   3. Gzip + base64-encode the SARIF document
 *   4. POST to GitHub API with 3-retry exponential backoff on 5xx
 *   5. Poll upload status every 5s (max 5 minutes) until processing_status='complete'
 *   6. Persist `sarif_last_uploaded_at` on each finding
 */
import { gzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { emitSarif } from '@/lib/export/sarif/emit'
import type { FindingRow } from '@/lib/export/sarif/emit'

type DB = BetterSQLite3Database<typeof schema>

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const MAX_RETRIES = 3

interface GithubConfig {
  pat: string
  owner: string
  repo: string
}

/**
 * Resolve and validate GitHub credentials from environment variables.
 *
 * @throws Error if any required credential is missing
 */
function resolveConfig(): GithubConfig {
  const pat = process.env.OBT_GITHUB_PAT
  const owner = process.env.OBT_GITHUB_OWNER
  const repo = process.env.OBT_GITHUB_REPO

  if (!pat || !owner || !repo) {
    throw new Error(
      'GitHub Code Scanning not configured — set OBT_GITHUB_PAT, OBT_GITHUB_OWNER, OBT_GITHUB_REPO',
    )
  }

  return { pat, owner, repo }
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * POST to GitHub with exponential backoff on 5xx (1s/2s/4s, max 3 retries).
 *
 * @throws Error if all retries are exhausted
 */
async function postWithRetry(url: string, headers: Record<string, string>, body: string): Promise<Response> {
  const delays = [1_000, 2_000, 4_000]
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, { method: 'POST', headers, body }) // github-api-fetch

    if (response.status >= 500) {
      lastError = new Error(`GitHub API error: HTTP ${response.status}`)
      if (attempt < MAX_RETRIES) {
        await sleep(delays[attempt] ?? 4_000)
        continue
      }
      throw lastError
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: HTTP ${response.status}`)
    }

    return response
  }

  throw lastError ?? new Error('GitHub API: exhausted retries')
}

/**
 * Poll the SARIF upload status until processing_status='complete' or timeout.
 */
async function pollUntilComplete(uploadUrl: string, headers: Record<string, string>): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const response = await fetch(uploadUrl, { method: 'GET', headers }) // github-api-fetch

    if (response.ok) {
      const data = await response.json() as { processing_status?: string }
      if (data.processing_status === 'complete') return
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

/**
 * Upload a scan's findings to GitHub Code Scanning as a SARIF 2.1.0 report.
 *
 * Idempotent in the sense that each upload creates a new SARIF upload record
 * in GitHub — GitHub deduplicates alerts based on fingerprints.
 *
 * After a successful upload and confirmed processing, persists
 * `sarif_last_uploaded_at` on each finding in the scan.
 *
 * @param scanId - The scan's primary key
 * @param db - Drizzle database instance
 * @returns The GitHub SARIF upload ID
 * @throws Error if credentials are missing or the GitHub request fails
 */
export async function uploadSarif(scanId: string, db: DB): Promise<string> {
  // ── Credentials ────────────────────────────────────────────────────────────
  const config = resolveConfig()

  // ── Query findings for scan ────────────────────────────────────────────────
  const rows = db
    .select()
    .from(findings)
    .where(eq(findings.scanId, scanId))
    .all()

  const findingRows: FindingRow[] = rows.map((r) => ({
    id: r.id,
    scanId: r.scanId,
    detector: r.detector,
    severity: r.severity,
    title: r.title,
    description: r.description,
    locationPath: r.locationPath,
    locationLineStart: r.locationLineStart,
    locationLineEnd: r.locationLineEnd ?? null,
    dedupKey: r.dedupKey ?? null,
  }))

  // ── Serialize to SARIF ─────────────────────────────────────────────────────
  const sarifDoc = emitSarif({ findings: findingRows, scanId, toolName: 'open-security' })
  const sarifJson = JSON.stringify(sarifDoc)

  // ── Gzip + base64 ─────────────────────────────────────────────────────────
  const compressed = gzipSync(Buffer.from(sarifJson, 'utf-8'))
  const encoded = compressed.toString('base64')

  // ── POST to GitHub ─────────────────────────────────────────────────────────
  const apiUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/code-scanning/sarifs`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.pat}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const body = JSON.stringify({ sarif: encoded })

  const response = await postWithRetry(apiUrl, headers, body)
  const uploadData = await response.json() as { id: string; url: string }

  // ── Poll until processing_status = 'complete' ──────────────────────────────
  await pollUntilComplete(uploadData.url, headers)

  // ── Persist sarifLastUploadedAt on findings ────────────────────────────────
  const now = new Date().toISOString()
  for (const row of rows) {
    db.update(findings)
      .set({ sarifLastUploadedAt: now })
      .where(eq(findings.id, row.id))
      .run()
  }

  return uploadData.id
}
