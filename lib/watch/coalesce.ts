/**
 * lib/watch/coalesce.ts
 *
 * Slack notification coalescer.
 *
 * Enforces a 5-minute minimum gap between Slack messages per repo+channel.
 * Desktop notifications are NOT rate-limited (no coalescing needed).
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { getLastNotificationAt } from '@/lib/repos/notification-log.repo'

type DB = BetterSQLite3Database<typeof schema>

/** Minimum gap between Slack notifications per repo (5 minutes) */
const COALESCE_WINDOW_MS = 5 * 60 * 1000

/**
 * Determine whether a notification for the given repo+channel should be
 * suppressed (coalesced) because one was sent recently.
 *
 * Returns `true` if a notification was sent within the last 5 minutes
 * (meaning the new notification should be skipped or deferred).
 * Returns `false` if it is safe to send (no recent notification or gap > 5min).
 *
 * Note: Only Slack is subject to coalescing. Desktop notifications always
 * return `false` from this function (unlimited rate).
 *
 * @param db - Drizzle database instance
 * @param repoId - Repository ID
 * @param channel - Notification channel ('slack' or 'desktop')
 * @returns true if notification should be suppressed, false if safe to send
 */
export function shouldCoalesce(db: DB, repoId: string, channel: string): boolean {
  const lastSentAt = getLastNotificationAt(db, repoId, channel)
  if (!lastSentAt) return false

  const lastSentMs = new Date(lastSentAt).getTime()
  const elapsedMs = Date.now() - lastSentMs

  return elapsedMs < COALESCE_WINDOW_MS
}
