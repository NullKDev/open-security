import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { validateGithubSignature } from '@/lib/webhook/github-signature'
import { insertWebhookEvent } from '@/lib/repos/webhook-events.repo'
import { processWebhookQueue } from '@/lib/webhook/webhook-processor'
import { getWebhookSecret } from '@/lib/repos/github-settings.repo'

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub PR webhook events. Flow:
 * 1. Read raw body as Buffer
 * 2. Validate HMAC-SHA256 signature via `x-hub-signature-256` header
 * 3. If invalid → 401
 * 4. Insert row into `webhook_events` with status='pending'
 * 5. Return 202 immediately (respond within GitHub's 3s timeout)
 * 6. Fire-and-forget: drain the webhook queue asynchronously
 *
 * Webhook secret resolution order:
 *   1. DB config table (`webhook_secret_encrypted`) — set via /api/settings/webhook-secret
 *   2. `OBT_WEBHOOK_SECRET` environment variable — migration path for existing users
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Read secret from DB first; fall back to env var for backward compatibility
  const dbSecret = getWebhookSecret()
  const secret = dbSecret ?? process.env.OBT_WEBHOOK_SECRET ?? ''

  const signatureHeader = req.headers.get('x-hub-signature-256') ?? ''
  const deliveryId = req.headers.get('x-github-delivery') ?? undefined
  const event = req.headers.get('x-github-event') ?? undefined

  // Read raw body as ArrayBuffer, convert to Buffer for HMAC validation
  const arrayBuf = await req.arrayBuffer()
  const payload = Buffer.from(arrayBuf)

  // Validate signature — must happen before any payload parsing
  if (!validateGithubSignature(payload, signatureHeader, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const bodyText = payload.toString('utf-8')
  let action: string | undefined
  try {
    const parsed = JSON.parse(bodyText) as { action?: string }
    action = parsed.action
  } catch {
    // payload not JSON — still valid (GitHub sends non-JSON for some event types)
  }

  const db = getDb()

  // Insert into durable queue (idempotent by delivery_id UNIQUE constraint)
  try {
    insertWebhookEvent(db, {
      deliveryId,
      event,
      action: action ?? null,
      payload: bodyText,
    })
  } catch {
    // UNIQUE constraint violation = duplicate delivery — acknowledge silently (idempotent)
    return NextResponse.json({ ok: true }, { status: 202 })
  }

  // Fire-and-forget: drain the queue asynchronously
  // Must NOT await — GitHub requires response within 3 seconds
  void processWebhookQueue(db)

  // 202 Accepted: event enqueued, processing happens asynchronously
  return NextResponse.json({ ok: true }, { status: 202 })
}
