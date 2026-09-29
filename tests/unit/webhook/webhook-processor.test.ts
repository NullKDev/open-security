/**
 * tests/unit/webhook/webhook-processor.test.ts
 *
 * TDD: T-C07 — webhook processor picks up pending events and processes them
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { insertWebhookEvent, listPendingWebhookEvents } from '@/lib/repos/webhook-events.repo'
import { processWebhookQueue } from '@/lib/webhook/webhook-processor'

describe('processWebhookQueue', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('exports processWebhookQueue as a function', () => {
    expect(typeof processWebhookQueue).toBe('function')
  })

  it('returns a Promise', () => {
    const result = processWebhookQueue(db)
    expect(result).toBeInstanceOf(Promise)
    return result
  })

  it('marks a pending PR open event as processed', async () => {
    insertWebhookEvent(db, {
      deliveryId: 'test-del-001',
      event: 'pull_request',
      action: 'opened',
      payload: JSON.stringify({
        action: 'opened',
        number: 7,
        pull_request: { head: { sha: 'abc' }, base: { sha: 'def' } },
        repository: { full_name: 'org/repo' },
      }),
    })

    await processWebhookQueue(db)

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(0)
  })

  it('marks a non-PR event as processed without error', async () => {
    insertWebhookEvent(db, {
      deliveryId: 'test-del-002',
      event: 'push',
      action: null,
      payload: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    await processWebhookQueue(db)

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(0)
  })

  it('marks a malformed payload as failed', async () => {
    insertWebhookEvent(db, {
      deliveryId: 'test-del-003',
      event: 'pull_request',
      action: 'opened',
      payload: 'NOT JSON {{{',
    })

    await processWebhookQueue(db)

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(0)

    // The event should be marked failed
    const row = sqlite
      .prepare(`SELECT status, error FROM webhook_events WHERE delivery_id='test-del-003'`)
      .get() as { status: string; error: string | null }
    expect(row.status).toBe('failed')
    expect(row.error).toBeTruthy()
  })

  it('processes multiple pending events', async () => {
    for (let i = 1; i <= 3; i++) {
      insertWebhookEvent(db, {
        deliveryId: `multi-del-${i}`,
        event: 'push',
        action: null,
        payload: '{}',
      })
    }

    await processWebhookQueue(db)

    const pending = listPendingWebhookEvents(db)
    expect(pending).toHaveLength(0)
  })
})
