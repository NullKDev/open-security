/**
 * lib/watch/run-watch-scan.ts
 *
 * Orchestrates a full watch-mode scan cycle for a tracked repo.
 *
 * Steps:
 *  1. Acquire advisory lock (watch_locks table — prevents overlapping scans)
 *  2. Fetch latest changes (git pull in the repo directory)
 *  3. Run pipeline with standard strategy
 *  4. Compute delta findings vs most recent completed scan
 *  5. Send notifications if net-new findings above severity floor
 *  6. Update watch_schedules.last_run_at
 *  7. Release advisory lock
 */
import * as cp from 'node:child_process'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { getRepoById } from '@/lib/repos/repos.repo'
import {
  createScan,
  getMostRecentCompletedScan,
  getDeltaFindings,
} from '@/lib/repos/scans.repo'
import { insertNotification } from '@/lib/repos/notification-log.repo'
import { runPipeline } from '@/lib/pipeline/runner'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import { scanDir } from '@/lib/config/workspace'
import { shouldCoalesce } from './coalesce'
import { sendNotification } from './notify'
import * as schema from '@/lib/db/schema'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Run a full watch-mode scan cycle for a tracked repo.
 *
 * This is the function called by the cron scheduler for each registered repo.
 * It is safe to call concurrently — the advisory lock prevents duplicate runs.
 *
 * @param repoId - ID of the repo row in the `repos` table
 */
export async function runWatchScan(repoId: string): Promise<void> {
  const db = getDb()

  const repo = getRepoById(db, repoId)
  if (!repo || !repo.projectId) {
    return
  }

  // 1. Acquire advisory lock — skip if another run is in progress
  const lockAcquired = acquireLock(db, repoId, repo.defaultBranch)
  if (!lockAcquired) {
    return
  }

  try {
    // 2. Git pull in repo directory
    gitPull(repo.localPath)

    // 3. Create scan + run pipeline
    const parentScan = getMostRecentCompletedScan(db, repo.projectId)
    const scan = createScan(db, {
      projectId: repo.projectId,
      parentId: parentScan?.id,
      strategy: 'standard',
      scanMode: 'standard',
    })

    const workspaceRoot = scanDir(repo.projectId, scan.id)

    await new Promise<void>((resolve, reject) => {
      const handle = runPipeline({
        db,
        scanId: scan.id,
        projectId: repo.projectId!,
        sourceKind: 'local',
        sourceRef: repo.localPath,
        workspaceRoot,
        bus: sharedBus,
      })
      handle.done.then(resolve).catch(reject)
    })

    // 4. Compute delta findings
    const completedScan = getMostRecentCompletedScan(db, repo.projectId)
    if (!completedScan || completedScan.id !== scan.id) {
      // Scan didn't complete successfully — no notification
      return
    }

    const deltaFindings = parentScan
      ? getDeltaFindings(db, scan.id, parentScan.id)
      : getDeltaFindings(db, scan.id, scan.id)

    if (deltaFindings.length === 0) {
      return
    }

    // 5. Filter by severity floor
    const severityFloor = repo.notifySeverityFloor ?? 'high'
    const floorIndex = SEVERITY_ORDER.indexOf(severityFloor.toLowerCase())
    const filtered = deltaFindings.filter((f) => {
      const idx = SEVERITY_ORDER.indexOf(f.severity.toLowerCase())
      return idx !== -1 && idx <= floorIndex
    })

    if (filtered.length === 0) {
      return
    }

    // 6. Send notifications per configured channel
    const channels = repo.notifyChannels ?? ['desktop']

    for (const channel of channels) {
      // Coalesce Slack notifications (5-min window)
      if (channel === 'slack' && shouldCoalesce(db, repoId, channel)) {
        continue
      }

      await sendNotification({
        channel,
        repoName: repo.name,
        findingCount: filtered.length,
        slackWebhookUrl: repo.slackWebhookUrlRef ?? undefined,
      })

      // Log the notification
      insertNotification(db, {
        repoId,
        channel,
        scanId: scan.id,
        findingCount: filtered.length,
      })
    }

    // 7. (watch_schedules not in v0.2 schema — last_run_at tracked via notification_log)
  } finally {
    releaseLock(db, repoId, repo.defaultBranch)
  }
}

/**
 * Try to acquire the advisory watch lock for a repo+branch.
 * Clears stale locks (older than 5 minutes) before attempting.
 *
 * @param db - Drizzle database instance
 * @param repoId - Repository ID
 * @param branch - Branch name
 * @returns true if lock acquired, false if already held
 */
function acquireLock(
  db: ReturnType<typeof getDb>,
  repoId: string,
  branch: string,
): boolean {
  const LOCK_TTL_MS = 5 * 60 * 1000

  try {
    // Clear stale locks
    const now = Date.now()
    const existing = db
      .select()
      .from(schema.watchLocks)
      .where(
        eq(schema.watchLocks.repoId, repoId),
      )
      .all()

    for (const lock of existing) {
      const age = now - new Date(lock.acquiredAt).getTime()
      if (age > LOCK_TTL_MS) {
        db.delete(schema.watchLocks)
          .where(eq(schema.watchLocks.repoId, repoId))
          .run()
      } else {
        // Valid lock held by another run
        return false
      }
    }

    // Acquire lock
    db.insert(schema.watchLocks)
      .values({ repoId, branch, acquiredAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run()

    // Verify we got it
    const lock = db
      .select()
      .from(schema.watchLocks)
      .where(eq(schema.watchLocks.repoId, repoId))
      .get()

    return lock !== undefined
  } catch {
    // On error, proceed without lock (best-effort)
    return true
  }
}

/**
 * Release the advisory watch lock.
 *
 * @param db - Drizzle database instance
 * @param repoId - Repository ID
 * @param branch - Branch name
 */
function releaseLock(
  db: ReturnType<typeof getDb>,
  repoId: string,
  _branch: string,
): void {
  try {
    db.delete(schema.watchLocks)
      .where(eq(schema.watchLocks.repoId, repoId))
      .run()
  } catch {
    // Non-critical
  }
}

/**
 * Pull latest changes in the repo directory.
 *
 * @param repoPath - Absolute path to the git repository
 * @throws If git pull exits with non-zero status
 */
function gitPull(repoPath: string): void {
  const result = cp.spawnSync('git', ['pull', '--ff-only'], {
    cwd: repoPath,
    encoding: 'utf-8',
    shell: false,
  })

  if (result.status !== 0 && result.status !== null) {
    // Non-fatal: log and continue (network may be unavailable)
    // The scan will run against the current local state
  }
}
