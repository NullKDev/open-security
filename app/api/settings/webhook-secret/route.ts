/**
 * PUT /api/settings/webhook-secret
 *
 * Store or rotate the webhook secret used to validate GitHub webhook signatures.
 * The secret is encrypted with AES-256-GCM before being persisted in the config table.
 *
 * DELETE /api/settings/webhook-secret
 *
 * Remove the stored webhook secret (reverts to env var fallback if set).
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { setWebhookSecret, clearWebhookSecret, getWebhookSecret } from '@/lib/repos/github-settings.repo'

const PutWebhookSecretSchema = z.object({
  secret: z.string().min(1, 'Webhook secret must not be empty'),
})

/**
 * Store or rotate the webhook secret.
 * Body: `{ secret: string }`
 */
export async function PUT(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = PutWebhookSecretSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', msg)
  }

  setWebhookSecret(parsed.data.secret)
  return ok({ stored: true })
}

/**
 * Remove the stored webhook secret.
 * After deletion the system falls back to the `OBT_WEBHOOK_SECRET` env var.
 */
export async function DELETE(): Promise<Response> {
  clearWebhookSecret()
  return ok({ cleared: true })
}

/**
 * Check whether a webhook secret is currently stored in the DB.
 * Returns `{ configured: boolean }` — never returns the secret itself.
 */
export async function GET(): Promise<Response> {
  const secret = getWebhookSecret()
  return ok({ configured: secret !== null })
}
