/**
 * @file lib/notifications/desktop.ts
 *
 * Desktop notification dispatcher for regression events.
 * Implements exactly-once-per-scan notification using the
 * notifications_dispatched table as an idempotency store.
 *
 * Design: ADR-5, REQ-RT-06 (v0.4 design.md)
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

type SqliteClient = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { changes: number }
  }
}

function getSqlite(db: DB): SqliteClient {
  return (db as unknown as { session: { client: SqliteClient } }).session.client
}

const REGRESSION_BATCH_KIND = 'regression-batch' as const

/**
 * Fires a desktop notification for regression events detected in a scan.
 * Uses INSERT OR IGNORE against notifications_dispatched to guarantee
 * exactly one notification per (scanId, kind) pair — idempotent on retry.
 *
 * Does nothing when count = 0.
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan that completed with regressions
 * @param count - Number of regressions detected in this scan
 * @returns true if the notification fired, false if it was already dispatched
 */
export function notifyRegressionsBatch(db: DB, scanId: string, count: number): boolean {
  if (count <= 0) return false

  const sqlite = getSqlite(db)
  const now = new Date().toISOString()

  // INSERT OR IGNORE: if the row already exists, the insert is silently skipped.
  // The `changes` count tells us whether a new row was inserted.
  const result = sqlite.prepare(`
    INSERT OR IGNORE INTO notifications_dispatched (scan_id, kind, ts)
    VALUES (?, ?, ?)
  `).run(scanId, REGRESSION_BATCH_KIND, now)

  const fired = result.changes > 0

  if (fired) {
    // Best-effort desktop notification — may not be available in all environments
    // (SSR/test/CI). Never throws.
    tryFireDesktopNotification(count)
  }

  return fired
}

/**
 * Attempts to fire a desktop notification using the Web Notifications API.
 * Silently suppressed in environments where Notification is not available
 * (Node.js, test, CI, SSR).
 *
 * @param count - Number of regressions to include in the notification body
 */
function tryFireDesktopNotification(count: number): void {
  try {
    // globalThis.Notification is available in browser/Electron environments
    const NotificationCtor = (globalThis as unknown as { Notification?: typeof Notification }).Notification
    if (!NotificationCtor) return

    // Permission may already be granted (e.g. in Electron/desktop shell)
    if (NotificationCtor.permission === 'granted') {
      new NotificationCtor(
        'open-security',
        {
          body: `${count} regression${count === 1 ? '' : 's'} detected — see queue`,
          tag: 'regression-batch',
        }
      )
    }
  } catch {
    // Non-critical — notification API may throw in some contexts
  }
}
