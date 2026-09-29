/**
 * tests/unit/watch/coalesce.test.ts
 *
 * TDD: T-H06 — Slack 5-minute coalescer
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { notificationLog } from '@/lib/db/schema'
import { insertNotification } from '@/lib/repos/notification-log.repo'
import { shouldCoalesce } from '@/lib/watch/coalesce'

const FIVE_MIN_MS = 5 * 60 * 1000

describe('shouldCoalesce', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  it('exports shouldCoalesce as a function', () => {
    expect(typeof shouldCoalesce).toBe('function')
  })

  it('returns false when no prior notification exists (first notification)', () => {
    const result = shouldCoalesce(db, 'repo-1', 'slack')
    expect(result).toBe(false)
  })

  it('returns true when a notification was sent within the last 5 minutes', () => {
    const recentSentAt = new Date(Date.now() - FIVE_MIN_MS + 60_000).toISOString() // 4 min ago

    // Manually insert a recent notification
    db.insert(notificationLog).values({
      repoId: 'repo-2',
      channel: 'slack',
      scanId: 'scan-1',
      findingCount: 3,
      sentAt: recentSentAt,
    }).run()

    const result = shouldCoalesce(db, 'repo-2', 'slack')
    expect(result).toBe(true)
  })

  it('returns false when the last notification was more than 5 minutes ago', () => {
    const oldSentAt = new Date(Date.now() - FIVE_MIN_MS - 60_000).toISOString() // 6 min ago

    db.insert(notificationLog).values({
      repoId: 'repo-3',
      channel: 'slack',
      scanId: 'scan-2',
      findingCount: 1,
      sentAt: oldSentAt,
    }).run()

    const result = shouldCoalesce(db, 'repo-3', 'slack')
    expect(result).toBe(false)
  })

  it('does not coalesce desktop channel based on slack history', () => {
    const recentSentAt = new Date(Date.now() - 60_000).toISOString() // 1 min ago

    db.insert(notificationLog).values({
      repoId: 'repo-4',
      channel: 'slack',
      scanId: 'scan-3',
      findingCount: 2,
      sentAt: recentSentAt,
    }).run()

    // Desktop channel has no recent notification → should not coalesce
    const result = shouldCoalesce(db, 'repo-4', 'desktop')
    expect(result).toBe(false)
  })

  it('coalesces per-repo (different repos do not affect each other)', () => {
    const recentSentAt = new Date(Date.now() - 60_000).toISOString()

    db.insert(notificationLog).values({
      repoId: 'repo-A',
      channel: 'slack',
      scanId: 'scan-4',
      findingCount: 1,
      sentAt: recentSentAt,
    }).run()

    // repo-B has no recent notification
    const result = shouldCoalesce(db, 'repo-B', 'slack')
    expect(result).toBe(false)
  })

  it('uses insertNotification from notification-log.repo', () => {
    // insertNotification should work and create a record
    expect(() => {
      insertNotification(db, {
        repoId: 'repo-5',
        channel: 'slack',
        scanId: 'scan-5',
        findingCount: 2,
      })
    }).not.toThrow()

    // Now shouldCoalesce should return true for this repo
    const result = shouldCoalesce(db, 'repo-5', 'slack')
    expect(result).toBe(true)
  })
})
