/**
 * tests/api/webhooks/github-secret.test.ts
 *
 * Tests that POST /api/webhooks/github:
 *   1. Uses the DB-stored secret when available (ignores env var)
 *   2. Falls back to env var when no DB secret is set
 *   3. Correctly rejects requests when neither matches
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

// ─── Shared in-memory DB ─────────────────────────────────────────────────────
let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// ─── No-op processWebhookQueue ────────────────────────────────────────────────
vi.mock('@/lib/webhook/webhook-processor', () => ({
  processWebhookQueue: vi.fn().mockResolvedValue(undefined),
}))

// ─── Set env var fallback ─────────────────────────────────────────────────────
const ENV_SECRET = 'env-fallback-secret'
process.env.OBT_WEBHOOK_SECRET = ENV_SECRET

import { POST } from '@/app/api/webhooks/github/route'
import { setWebhookSecret, clearWebhookSecret } from '@/lib/repos/github-settings.repo'

function makeSignature(payload: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

function makeRequest(body: string, signature: string, deliveryId = `del-${Date.now()}`) {
  return new Request('http://localhost/api/webhooks/github', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'pull_request',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
    },
  })
}

describe('POST /api/webhooks/github — secret resolution', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
    vi.clearAllMocks()
  })

  describe('DB secret takes priority over env var', () => {
    it('accepts a request signed with the DB secret when DB secret is set', async () => {
      const DB_SECRET = 'db-stored-secret-xyz'
      setWebhookSecret(DB_SECRET)

      const body = JSON.stringify({ action: 'opened', number: 1 })
      const sig = makeSignature(Buffer.from(body), DB_SECRET)
      const res = await POST(makeRequest(body, sig))

      expect(res.status).toBe(202)
    })

    it('rejects a request signed with env var secret when DB secret is set', async () => {
      const DB_SECRET = 'db-stored-secret-xyz'
      setWebhookSecret(DB_SECRET)

      const body = JSON.stringify({ action: 'opened', number: 2 })
      // Sign with env var secret — should be rejected because DB secret takes priority
      const sig = makeSignature(Buffer.from(body), ENV_SECRET)
      const res = await POST(makeRequest(body, sig))

      expect(res.status).toBe(401)
    })
  })

  describe('env var fallback when no DB secret', () => {
    it('accepts a request signed with env var when no DB secret is configured', async () => {
      // Ensure no DB secret is set
      clearWebhookSecret()

      const body = JSON.stringify({ action: 'opened', number: 3 })
      const sig = makeSignature(Buffer.from(body), ENV_SECRET)
      const res = await POST(makeRequest(body, sig))

      expect(res.status).toBe(202)
    })

    it('rejects an invalid signature even with env var fallback', async () => {
      clearWebhookSecret()

      const body = JSON.stringify({ action: 'opened', number: 4 })
      const sig = 'sha256=0000deadbeef'
      const res = await POST(makeRequest(body, sig))

      expect(res.status).toBe(401)
    })
  })

  describe('secret rotation', () => {
    it('uses the new secret after rotation', async () => {
      setWebhookSecret('old-secret')
      setWebhookSecret('new-secret')

      const body = JSON.stringify({ action: 'synchronize', number: 5 })

      // Old secret must now fail
      const oldSig = makeSignature(Buffer.from(body), 'old-secret')
      const oldRes = await POST(makeRequest(body, oldSig, 'del-old'))
      expect(oldRes.status).toBe(401)

      // New secret must succeed
      const newSig = makeSignature(Buffer.from(body), 'new-secret')
      const newRes = await POST(makeRequest(body, newSig, 'del-new'))
      expect(newRes.status).toBe(202)
    })
  })
})
