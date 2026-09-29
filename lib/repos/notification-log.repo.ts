import { and, desc, eq, max } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { notificationLog } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface NotificationLogDTO {
  id: number
  repoId: string
  channel: string
  scanId: string | null
  findingCount: number
  sentAt: string
}

export interface InsertNotificationInput {
  repoId: string
  /** desktop | slack */
  channel: string
  scanId?: string | null
  findingCount: number
}

function rowToDTO(row: typeof notificationLog.$inferSelect): NotificationLogDTO {
  return {
    id: row.id,
    repoId: row.repoId,
    channel: row.channel,
    scanId: row.scanId ?? null,
    findingCount: row.findingCount,
    sentAt: row.sentAt,
  }
}

/**
 * Record that a notification was sent for a repo/channel.
 * Returns the newly created log entry.
 */
export function insertNotification(db: DB, input: InsertNotificationInput): NotificationLogDTO {
  const now = new Date().toISOString()

  const result = db.insert(notificationLog).values({
    repoId: input.repoId,
    channel: input.channel,
    scanId: input.scanId ?? null,
    findingCount: input.findingCount,
    sentAt: now,
  }).run()

  const row = db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.id, Number(result.lastInsertRowid)))
    .get()

  if (!row) throw new Error('Failed to read back notification log entry')
  return rowToDTO(row)
}

/**
 * Return the sent_at timestamp of the most recent notification for a given
 * repo+channel combination. Used by the 5-minute Slack coalescer.
 *
 * Returns null if no notifications have been sent.
 */
export function getLastNotificationAt(
  db: DB,
  repoId: string,
  channel: string,
): string | null {
  const result = db
    .select({ lastSentAt: max(notificationLog.sentAt) })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.repoId, repoId),
        eq(notificationLog.channel, channel),
      ),
    )
    .get()

  return result?.lastSentAt ?? null
}

/**
 * List all notification log entries for a repo, most recent first.
 */
export function listNotificationsForRepo(db: DB, repoId: string): NotificationLogDTO[] {
  const rows = db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.repoId, repoId))
    .orderBy(desc(notificationLog.sentAt))
    .all()

  return rows.map(rowToDTO)
}
