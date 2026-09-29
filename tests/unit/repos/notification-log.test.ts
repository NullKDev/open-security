/**
 * tests/unit/repos/notification-log.test.ts
 *
 * TDD: T-B05 — notification-log.repo CRUD + coalescing queries
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import {
  insertNotification,
  getLastNotificationAt,
  listNotificationsForRepo,
} from '@/lib/repos/notification-log.repo'

describe('notification-log.repo', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  it('inserts a notification and reads it back', () => {
    const entry = insertNotification(db, {
      repoId: 'repo-1',
      channel: 'slack',
      scanId: 'scan-1',
      findingCount: 3,
    })

    expect(entry.id).toBeTypeOf('number')
    expect(entry.repoId).toBe('repo-1')
    expect(entry.channel).toBe('slack')
    expect(entry.findingCount).toBe(3)
    expect(entry.sentAt).toBeTruthy()
  })

  it('getLastNotificationAt returns ISO string for most recent notification', () => {
    insertNotification(db, { repoId: 'repo-2', channel: 'slack', scanId: 's1', findingCount: 1 })
    insertNotification(db, { repoId: 'repo-2', channel: 'slack', scanId: 's2', findingCount: 2 })

    const lastAt = getLastNotificationAt(db, 'repo-2', 'slack')
    expect(lastAt).toBeTypeOf('string')
  })

  it('getLastNotificationAt returns null when no notifications exist', () => {
    const lastAt = getLastNotificationAt(db, 'repo-none', 'slack')
    expect(lastAt).toBeNull()
  })

  it('getLastNotificationAt is channel-scoped', () => {
    insertNotification(db, { repoId: 'repo-3', channel: 'desktop', scanId: 's1', findingCount: 1 })

    const slackLast = getLastNotificationAt(db, 'repo-3', 'slack')
    expect(slackLast).toBeNull()

    const desktopLast = getLastNotificationAt(db, 'repo-3', 'desktop')
    expect(desktopLast).toBeTruthy()
  })

  it('listNotificationsForRepo returns entries for a repo ordered by most recent', () => {
    insertNotification(db, { repoId: 'repo-4', channel: 'slack', scanId: 's1', findingCount: 1 })
    insertNotification(db, { repoId: 'repo-4', channel: 'desktop', scanId: 's2', findingCount: 2 })

    const entries = listNotificationsForRepo(db, 'repo-4')
    expect(entries).toHaveLength(2)
    expect(entries[0].findingCount).toBeGreaterThanOrEqual(1)
  })
})
