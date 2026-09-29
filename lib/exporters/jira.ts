/**
 * lib/exporters/jira.ts
 *
 * Export a finding to Jira as an issue using the Jira REST API v3.
 *
 * Credentials (all required):
 *   OBT_JIRA_BASE_URL      — e.g. https://yourorg.atlassian.net
 *   OBT_JIRA_PROJECT_KEY   — e.g. SEC
 *   OBT_JIRA_EMAIL         — Atlassian account email
 *   OBT_JIRA_API_TOKEN     — Atlassian API token
 *
 * Idempotency: if `jira_issue_key` is already set for the finding, returns it
 * immediately without making a network call.
 *
 * Retry: 429 responses trigger a single retry with 1s backoff.
 * 4xx errors (non-429): the error is written to `findings.last_export_error`
 * before the exception is re-thrown.
 */
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

const RETRY_DELAY_MS = 1000

interface JiraConfig {
  baseUrl: string
  projectKey: string
  email: string
  apiToken: string
}

/**
 * Resolve and validate Jira credentials from environment variables.
 *
 * @throws Error if any required credential is missing
 */
function resolveConfig(): JiraConfig {
  const baseUrl = process.env.OBT_JIRA_BASE_URL
  const projectKey = process.env.OBT_JIRA_PROJECT_KEY
  const email = process.env.OBT_JIRA_EMAIL
  const apiToken = process.env.OBT_JIRA_API_TOKEN

  if (!baseUrl || !projectKey || !email || !apiToken) {
    throw new Error(
      'Jira not configured — set OBT_JIRA_BASE_URL, OBT_JIRA_PROJECT_KEY, OBT_JIRA_EMAIL, OBT_JIRA_API_TOKEN',
    )
  }

  return { baseUrl, projectKey, email, apiToken }
}

/**
 * Build a minimal Jira issue body using ADF (Atlassian Document Format).
 * Title → summary; description rendered as a single paragraph node.
 */
function buildIssuePayload(
  projectKey: string,
  title: string,
  description: string,
): unknown {
  return {
    fields: {
      project: { key: projectKey },
      summary: title,
      issuetype: { name: 'Bug' },
      description: {
        version: 1,
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description || title }],
          },
        ],
      },
    },
  }
}

/** Sleep for `ms` milliseconds (awaitable). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Write an export error record to `findings.last_export_error`.
 */
function persistExportError(db: DB, findingId: string, message: string): void {
  const err = JSON.stringify({ target: 'jira', message, at: new Date().toISOString() })
  db.update(findings)
    .set({ lastExportError: err })
    .where(eq(findings.id, findingId))
    .run()
}

/**
 * Export a finding to Jira and persist the resulting issue key.
 *
 * Idempotent: if `jira_issue_key` is already set, returns it without a network call.
 * On 429, retries once after a 1-second delay.
 * On other 4xx errors, writes `last_export_error` and throws.
 *
 * @param findingId - The finding's primary key
 * @param db - Drizzle database instance
 * @returns The Jira issue key (e.g. 'SEC-123')
 * @throws Error if credentials are missing or the Jira request fails
 */
export async function exportToJira(findingId: string, db: DB): Promise<string> {
  // ── Idempotency check ──────────────────────────────────────────────────────
  const existing = db
    .select({
      jiraIssueKey: findings.jiraIssueKey,
      title: findings.title,
      description: findings.description,
    })
    .from(findings)
    .where(eq(findings.id, findingId))
    .get()

  if (!existing) {
    throw new Error(`Finding ${findingId} not found`)
  }

  if (existing.jiraIssueKey) {
    return existing.jiraIssueKey
  }

  // ── Credentials ────────────────────────────────────────────────────────────
  const config = resolveConfig()

  const url = `${config.baseUrl}/rest/api/3/issue`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
  }
  const body = JSON.stringify(buildIssuePayload(config.projectKey, existing.title, existing.description))

  // ── POST with single 429 retry ─────────────────────────────────────────────
  let response = await fetch(url, { method: 'POST', headers, body }) // user-webhook-fetch

  if (response.status === 429) {
    await sleep(RETRY_DELAY_MS)
    response = await fetch(url, { method: 'POST', headers, body }) // user-webhook-fetch
  }

  if (!response.ok) {
    let message = `Jira API error: HTTP ${response.status}`
    try {
      const json = await response.json() as Record<string, unknown>
      if (Array.isArray(json.errorMessages) && json.errorMessages.length > 0) {
        message = `Jira API error: ${(json.errorMessages as string[]).join('; ')}`
      }
    } catch {
      // Ignore JSON parse errors
    }

    persistExportError(db, findingId, message)
    throw new Error(message)
  }

  // ── Persist issue key ──────────────────────────────────────────────────────
  const data = await response.json() as { key: string }
  const issueKey = data.key
  const now = new Date().toISOString()

  db.update(findings)
    .set({ jiraIssueKey: issueKey, jiraLastSyncedAt: now })
    .where(eq(findings.id, findingId))
    .run()

  return issueKey
}
