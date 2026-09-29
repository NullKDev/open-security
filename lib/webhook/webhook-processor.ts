/**
 * lib/webhook/webhook-processor.ts
 *
 * Drain the webhook_events queue and trigger diff scans for PR events.
 *
 * Architecture: SQLite IS the queue (durable across restarts). Each pending
 * webhook event is processed in-process. For PR events with triggering actions
 * (opened/synchronize/reopened), this creates a diff scan via the scan route
 * and wires it to the pipeline runner.
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import {
  listPendingWebhookEvents,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@/lib/repos/webhook-events.repo'
import { listRepos } from '@/lib/repos/repos.repo'
import { createScan, getMostRecentCompletedScan } from '@/lib/repos/scans.repo'
import { runPipeline } from '@/lib/pipeline/runner'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import { scanDir } from '@/lib/config/workspace'

type DB = BetterSQLite3Database<typeof schema>

/** Recognized GitHub PR event actions that should trigger a diff scan */
const DIFF_TRIGGER_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])

interface PullRequestPayload {
  action?: string
  number?: number
  pull_request?: {
    head?: { sha?: string; ref?: string }
    base?: { sha?: string; ref?: string }
  }
  repository?: {
    full_name?: string
  }
}

/**
 * Drain the webhook_events queue: fetch all pending rows, process each one,
 * and mark as processed or failed.
 *
 * For pull_request events with a diff-triggering action (opened/synchronize/reopened):
 * - Find a matching repo (by repository.full_name or webhook_events.repo_id)
 * - Create a diff scan with the PR's base/head SHAs
 * - Kick off the pipeline runner (fire-and-forget)
 * - Mark the webhook event as processed with the new scan_id
 *
 * @param db - Drizzle database instance (injected for testability)
 */
export async function processWebhookQueue(db: DB): Promise<void> {
  const pending = listPendingWebhookEvents(db)

  for (const event of pending) {
    try {
      let payload: PullRequestPayload
      try {
        payload = JSON.parse(event.payload) as PullRequestPayload
      } catch (parseErr) {
        markWebhookEventFailed(
          db,
          event.id,
          `Invalid JSON payload: ${String(parseErr)}`,
        )
        continue
      }

      const isPrEvent = event.event === 'pull_request'
      const action = payload.action ?? event.action ?? null

      if (isPrEvent && action && DIFF_TRIGGER_ACTIONS.has(action)) {
        const scanId = await triggerDiffScan(db, event.repoId, payload)
        markWebhookEventProcessed(db, event.id, scanId)
      } else {
        // Non-triggering events (push, label, etc.) — acknowledge and skip
        markWebhookEventProcessed(db, event.id, null)
      }
    } catch (err) {
      markWebhookEventFailed(db, event.id, String(err))
    }
  }
}

/**
 * Create and start a diff scan for a PR webhook event.
 *
 * @param db - Drizzle database instance
 * @param repoId - Repo ID from the webhook_events row (may be null for unregistered repos)
 * @param payload - Parsed PR webhook payload
 * @returns The new scan ID, or null if no matching repo was found
 */
async function triggerDiffScan(
  db: DB,
  repoId: string | null,
  payload: PullRequestPayload,
): Promise<string | null> {
  // Resolve repo: use event.repo_id if set, otherwise try to match by full_name
  let projectId: string | null = null
  let localPath: string = ''

  if (repoId) {
    const { getRepoById } = await import('@/lib/repos/repos.repo')
    const repo = getRepoById(db, repoId)
    if (repo && repo.projectId) {
      projectId = repo.projectId
      localPath = repo.localPath
    }
  }

  if (!projectId) {
    // Try to match by full_name against registered repos
    const fullName = payload.repository?.full_name
    if (fullName) {
      const allRepos = listRepos(db)
      const match = allRepos.find(
        (r) =>
          r.localPath.includes(fullName.split('/')[1]) ||
          r.name === fullName.split('/')[1],
      )
      if (match && match.projectId) {
        projectId = match.projectId
        localPath = match.localPath
      }
    }
  }

  if (!projectId) {
    // No matching repo — cannot trigger scan
    return null
  }

  const prNumber = payload.number
  const baseSha = payload.pull_request?.base?.sha
  const headSha = payload.pull_request?.head?.sha

  if (!prNumber || !baseSha || !headSha) {
    return null
  }

  const parentScan = getMostRecentCompletedScan(db, projectId)

  const scan = createScan(db, {
    projectId,
    parentId: parentScan?.id,
    strategy: 'diff',
    scanMode: 'standard',
    prNumber,
    baseSha,
    headSha,
  })

  const workspaceRoot = scanDir(projectId, scan.id)

  const handle = runPipeline({
    db,
    scanId: scan.id,
    projectId,
    sourceKind: 'local',
    sourceRef: localPath,
    workspaceRoot,
    bus: sharedBus,
    strategy: 'diff',
    diffContext: { baseSha, headSha, changedFiles: [] },
  })

  // Fire-and-forget
  handle.done.catch(() => {
    // Errors are persisted to the scan row by the runner
  })

  return scan.id
}
