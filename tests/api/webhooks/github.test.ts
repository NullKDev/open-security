/**
 * tests/api/webhooks/github.test.ts
 *
 * TDD: T-C03 — POST /api/webhooks/github
 * Tests: 401 on bad/missing signature, 200 on valid signature, idempotency by delivery_id
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { listPendingWebhookEvents } from '@/lib/repos/webhook-events.repo'

// ─── Mock processWebhookQueue to be a no-op ──────────────────────────────────
vi.mock('@/lib/webhook/webhook-processor', () => ({
  processWebhookQueue: vi.fn().mockResolvedValue(undefined),
}))

// ─── Mock getDb to return in-memory test database ────────────────────────────
let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// ─── Set webhook secret via environment variable ──────────────────────────────
const WEBHOOK_SECRET = 'test-webhook-secret-abc'
process.env.OBT_WEBHOOK_SECRET = WEBHOOK_SECRET

import { POST } from '@/app/api/webhooks/github/route'

function makeSignature(payload: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

function makeRequest(body: string, signature: string | null, deliveryId = 'del-test-001') {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': 'pull_request',
    'x-github-delivery': deliveryId,
  }
  if (signature !== null) {
    headers['x-hub-signature-256'] = signature
  }
  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    body,
    headers,
  })
}

describe('POST /api/webhooks/github', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
    vi.clearAllMocks()
  })

  describe('signature validation', () => {
    it('returns 401 when signature header is missing', async () => {
      const body = JSON.stringify({ action: 'opened' })
      const req = makeRequest(body, null)
      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('returns 401 when signature is invalid', async () => {
      const body = JSON.stringify({ action: 'opened' })
      const req = makeRequest(body, 'sha256=badhex000')
      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('returns 401 for tampered payload', async () => {
      const original = Buffer.from(JSON.stringify({ action: 'opened' }))
      const sig = makeSignature(original, WEBHOOK_SECRET)
      // Send different body but same signature
      const req = makeRequest(JSON.stringify({ action: 'closed' }), sig)
      const res = await POST(req)
      expect(res.status).toBe(401)
    })
  })

  describe('valid webhook', () => {
    it('returns 202 for a valid signature', async () => {
      const body = JSON.stringify({ action: 'opened', number: 1 })
      const bodyBuf = Buffer.from(body)
      const sig = makeSignature(bodyBuf, WEBHOOK_SECRET)
      const req = makeRequest(body, sig)
      const res = await POST(req)
      expect(res.status).toBe(202)
    })

    it('inserts a pending webhook_event row', async () => {
      const body = JSON.stringify({ action: 'opened', number: 2 })
      const bodyBuf = Buffer.from(body)
      const sig = makeSignature(bodyBuf, WEBHOOK_SECRET)
      const req = makeRequest(body, sig, 'del-insert-001')
      await POST(req)

      const pending = listPendingWebhookEvents(testDb)
      expect(pending.length).toBeGreaterThanOrEqual(1)
      expect(pending.some((e) => e.deliveryId === 'del-insert-001')).toBe(true)
    })

    it('does not duplicate event on retry with same delivery_id', async () => {
      const body = JSON.stringify({ action: 'opened', number: 3 })
      const bodyBuf = Buffer.from(body)
      const sig = makeSignature(bodyBuf, WEBHOOK_SECRET)

      // First request
      const req1 = makeRequest(body, sig, 'del-dup-001')
      await POST(req1)

      // Second request with same delivery_id — should be idempotent (200 but no duplicate row)
      const req2 = makeRequest(body, sig, 'del-dup-001')
      const res2 = await POST(req2)
      expect(res2.status).toBe(202)

      const events = listPendingWebhookEvents(testDb)
      const dup = events.filter((e) => e.deliveryId === 'del-dup-001')
      expect(dup).toHaveLength(1)
    })
  })
})
