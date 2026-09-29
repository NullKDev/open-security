/**
 * instrumentation.ts
 *
 * Next.js 16 server startup hook (instrumentation API).
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Runs ONCE when the server starts (not on every request, not in Edge runtime).
 * Guards against HMR double-init via `globalThis.__obtScheduler`.
 *
 * Startup order:
 *  1. Run pending DB migrations (before scheduler — schema must exist)
 *  2. Start Watch Mode scheduler (registers enabled repos from DB)
 *  3. Start smee relay (if SMEE_CHANNEL_URL is configured)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GlobalWithScheduler = typeof globalThis & { __obtScheduler?: unknown }

/**
 * Next.js instrumentation entry point.
 * Called once when the server process starts.
 */
export async function register(): Promise<void> {
  // Only run in Node.js runtime, not Edge
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Guard: prevent HMR double-init
  const g = globalThis as GlobalWithScheduler
  if (g.__obtScheduler) {
    return
  }

  let db: ReturnType<Awaited<typeof import('@/lib/db/client')>['getDb']> | null = null

  try {
    // 1. Run pending DB migrations first (schema must exist before scheduler reads DB)
    const { getDb } = await import('@/lib/db/client')
    // getDb() runs migrations on first call
    db = getDb()
  } catch (err) {
    console.error(`[instrumentation] DB init error: ${String(err)}\n`)
    // Non-fatal: DB may not be ready yet
  }

  // 1b. Integrity check — logs any enum violations, never crashes
  if (db) {
    try {
      const { checkIntegrity } = await import('@/lib/db/integrity')
      const report = checkIntegrity(db)
      if (!report.ok) {
        for (const issue of report.issues) {
          console.error(`[integrity] ${issue}\n`)
        }
      }
    } catch (err) {
      console.error(`[instrumentation] integrity check error: ${String(err)}\n`)
    }
  }

  // 1c. Prune stale in-progress proofs from prior crash
  if (db) {
    try {
      const { pruneStaleProofs } = await import('@/lib/remediation/fix-and-prove/proof-cleanup')
      const cleaned = await pruneStaleProofs(db)
      if (cleaned > 0) {
        console.log(`[instrumentation] pruned ${cleaned} stale proof(s)\n`)
      }
    } catch (err) {
      console.error(`[instrumentation] proof cleanup error: ${String(err)}\n`)
    }
  }

  try {
    // 2. Start Watch Mode scheduler
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    startWatchScheduler()
    // Note: globalThis.__obtScheduler is set inside startWatchScheduler()
  } catch (err) {
    console.error(`[instrumentation] Watch scheduler start error: ${String(err)}\n`)
  }

  // 2b. Schedule weekly Slack digest (no-op if OBT_SLACK_WEBHOOK_URL not set)
  if (db && process.env.OBT_SLACK_WEBHOOK_URL) {
    try {
      const { sendWeeklyDigest } = await import('@/lib/exporters/slack')
      // Fire-and-forget on startup; idempotency guard inside sendWeeklyDigest
      sendWeeklyDigest(db).catch((err: unknown) => {
        console.error(`[instrumentation] Slack digest error: ${String(err)}\n`)
      })
    } catch (err) {
      console.error(`[instrumentation] Slack digest import error: ${String(err)}\n`)
    }
  }

  try {
    // 3. Start smee relay if configured
    const smeeChannel = process.env.SMEE_CHANNEL_URL
    const webhookLocal = process.env.SMEE_LOCAL_URL ?? 'http://localhost:3000/api/webhooks/github'

    if (smeeChannel) {
      const { startSmeeRelay } = await import('@/lib/webhook/smee-relay')
      startSmeeRelay(smeeChannel, webhookLocal)
      console.log(`[instrumentation] smee relay started → ${webhookLocal}\n`)
    }
  } catch (err) {
    console.error(`[instrumentation] smee relay start error: ${String(err)}\n`)
  }
}
