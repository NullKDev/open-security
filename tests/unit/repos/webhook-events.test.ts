/**
 * tests/unit/repos/webhook-events.test.ts
 *
 * TDD: T-B03 — webhook-events.repo CRUD
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import {
  insertWebhookEvent,
  getWebhookEventById,
  listPendingWebhookEvents,
  markWebhookEventProcessed,
  markWebhookEventFailed,
} from '@/lib/repos/webhook-events.repo'

describe('webhook-events.repo', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  it('inserts a webhook event and reads it back', () => {
    const ev = insertWebhookEvent(db, {
      payload: JSON.stringify({ action: 'opened' }),
      deliveryId: 'del-001',
      event: 'pull_request',
      action: 'opened',
    })

    expect(ev.id).toBeTruthy()
    expect(ev.status).toBe('pending')
    expect(ev.deliveryId).toBe('del-001')

    const fetched = getWebhookEventById(db, ev.id)
    expect(fetched).toBeDefined()
    expect(fetched!.payload).toBe(JSON.stringify({ action: 'opened' }))
  })

  it('lists pending events', () => {
    insertWebhookEvent(db, { payload: '{}', deliveryId: 'd1', event: 'pull_request', action: 'opened' })
    insertWebhookEvent(db, { payload: '{}', deliveryId: 'd2', event: 'pull_request', action: 'synchronize' })

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(2)
    expect(pending.every((e) => e.status === 'pending')).toBe(true)
  })

  it('marks event as processed', () => {
    const ev = insertWebhookEvent(db, { payload: '{}', deliveryId: 'd3', event: 'pull_request', action: 'opened' })
    markWebhookEventProcessed(db, ev.id, 'scan-123')

    const updated = getWebhookEventById(db, ev.id)
    expect(updated!.status).toBe('processed')
    expect(updated!.scanId).toBe('scan-123')
    expect(updated!.processedAt).toBeTruthy()
  })

  it('marks event as failed with error', () => {
    const ev = insertWebhookEvent(db, { payload: '{}', deliveryId: 'd4', event: 'pull_request', action: 'opened' })
    markWebhookEventFailed(db, ev.id, 'something went wrong')

    const updated = getWebhookEventById(db, ev.id)
    expect(updated!.status).toBe('failed')
    expect(updated!.error).toBe('something went wrong')
    expect(updated!.processedAt).toBeTruthy()
  })

  it('does not list processed events as pending', () => {
    const ev = insertWebhookEvent(db, { payload: '{}', deliveryId: 'd5', event: 'pull_request', action: 'opened' })
    markWebhookEventProcessed(db, ev.id, null)

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(0)
  })

  it('enforces delivery_id uniqueness', () => {
    insertWebhookEvent(db, { payload: '{}', deliveryId: 'dup-id', event: 'pull_request', action: 'opened' })
    expect(() =>
      insertWebhookEvent(db, { payload: '{}', deliveryId: 'dup-id', event: 'push', action: null }),
    ).toThrow()
  })
})
