/**
 * lib/watch/scheduler.ts
 *
 * Watch Mode cron scheduler.
 *
 * Registers per-repo cron jobs using a polling interval derived from the cron
 * expression. Uses setInterval as a fallback (node-cron is not in the dependency
 * list — install it to get true cron scheduling).
 *
 * Singleton pattern via `globalThis.__obtScheduler` prevents HMR double-init
 * in Next.js dev mode.
 */

/** Seconds between scheduler poll cycles (approximate cron resolution) */
const POLL_INTERVAL_MS = 60_000 // 1 minute

interface RepoJob {
  repoId: string
  cronExpr: string
  onTick: () => void | Promise<void>
  intervalHandle: ReturnType<typeof setInterval>
}

interface SchedulerState {
  jobs: Map<string, RepoJob>
  pollInterval: ReturnType<typeof setInterval> | null
}

interface RegisterRepoOpts {
  /** Repository ID to schedule */
  repoId: string
  /** Cron expression (e.g. "0 STAR/6 * * *" where STAR = asterisk) */
  cronExpr: string
  /** Callback invoked each time the cron fires */
  onTick: () => void | Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobalWithScheduler = typeof globalThis & { __obtScheduler?: SchedulerState }

function getOrCreateState(): SchedulerState {
  const g = globalThis as GlobalWithScheduler
  if (!g.__obtScheduler) {
    g.__obtScheduler = {
      jobs: new Map(),
      pollInterval: null,
    }
  }
  return g.__obtScheduler
}

/**
 * Parse an approximate interval in milliseconds from a cron expression.
 *
 * This is a simplified parser sufficient for the supported patterns:
 * - `0 *\/N * * *` → N hours in ms
 * - `0 H * * *`   → 24 hours in ms (once daily)
 * - `0 H * * 1-5` → 24 hours in ms (weekdays only — approximated)
 *
 * For accurate cron scheduling, add `node-cron` to dependencies.
 */
function approxIntervalMs(cronExpr: string): number {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length < 5) return 6 * 60 * 60 * 1000 // default 6h

  const hourField = parts[1]

  // */N pattern: every N hours
  const everyHourMatch = hourField.match(/^\*\/(\d+)$/)
  if (everyHourMatch) {
    const n = parseInt(everyHourMatch[1], 10)
    return n * 60 * 60 * 1000
  }

  // Fixed hour → run once per day
  if (/^\d+$/.test(hourField)) {
    return 24 * 60 * 60 * 1000
  }

  // Default to 6 hours
  return 6 * 60 * 60 * 1000
}

/**
 * Register a repo for watch scheduling. The onTick callback is invoked each
 * time the approximate cron interval elapses.
 *
 * Must call startWatchScheduler() before registering repos.
 *
 * @param opts.repoId - Unique repo identifier
 * @param opts.cronExpr - Cron expression (e.g. '0 *\/6 * * *' for every 6h)
 * @param opts.onTick - Called on each cron tick
 */
export function registerRepo(opts: RegisterRepoOpts): void {
  const state = getOrCreateState()
  const { repoId, cronExpr, onTick } = opts

  // Clear existing job for this repo if one exists
  const existing = state.jobs.get(repoId)
  if (existing) {
    clearInterval(existing.intervalHandle)
  }

  const intervalMs = approxIntervalMs(cronExpr)
  const handle = setInterval(() => {
    void Promise.resolve(onTick()).catch((err: unknown) => {
      process.stderr.write(`[watch-scheduler] error in repo ${repoId} tick: ${String(err)}\n`)
    })
  }, intervalMs)

  state.jobs.set(repoId, {
    repoId,
    cronExpr,
    onTick,
    intervalHandle: handle,
  })
}

/**
 * Unregister a repo from the watch scheduler. Safe to call for unknown repoIds.
 *
 * @param repoId - Repository ID to remove
 */
export function unregisterRepo(repoId: string): void {
  const state = getOrCreateState()
  const job = state.jobs.get(repoId)
  if (job) {
    clearInterval(job.intervalHandle)
    state.jobs.delete(repoId)
  }
}

/**
 * Start the watch scheduler. Guards against HMR double-init via
 * `globalThis.__obtScheduler`.
 *
 * Call this from `instrumentation.ts` on server startup.
 *
 * @returns A stop function that clears all scheduled jobs
 */
export function startWatchScheduler(): () => void {
  const state = getOrCreateState()

  // If already running, return a noop stop (HMR guard)
  if (state.pollInterval !== null) {
    return () => { /* already running — caller should use stopWatchScheduler() */ }
  }

  // Minimal heartbeat poll — individual jobs use setInterval with their own cadence
  state.pollInterval = setInterval(() => {
    // heartbeat: no-op — individual job intervals handle firing
  }, POLL_INTERVAL_MS)

  return () => {
    if (state.pollInterval !== null) {
      clearInterval(state.pollInterval)
      state.pollInterval = null
    }
    for (const job of state.jobs.values()) {
      clearInterval(job.intervalHandle)
    }
    state.jobs.clear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as GlobalWithScheduler).__obtScheduler
  }
}
