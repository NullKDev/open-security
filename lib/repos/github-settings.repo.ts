/**
 * lib/repos/github-settings.repo.ts
 *
 * Reads and writes the webhook secret through the encrypted credential system.
 *
 * The secret is stored in the `config` table under the key `webhook_secret_encrypted`
 * as a base64-encoded AES-256-GCM envelope (see lib/crypto/webhook-secret.ts).
 *
 * This keeps the secret out of plaintext in the `repos` table and decouples it
 * from environment variables, satisfying the v0.2 webhook-receiver spec requirement.
 */

import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { config as configTable } from '@/lib/db/schema'
import { encrypt, decrypt } from '@/lib/crypto/webhook-secret'

const WEBHOOK_SECRET_KEY = 'webhook_secret_encrypted'

/**
 * Retrieve the stored webhook secret, decrypting it from the config table.
 *
 * @returns The plaintext webhook secret, or null if not set
 */
export function getWebhookSecret(): string | null {
  const db = getDb()
  const row = db
    .select()
    .from(configTable)
    .where(eq(configTable.key, WEBHOOK_SECRET_KEY))
    .get()

  if (!row) return null
  return decrypt(row.value)
}

/**
 * Encrypt and persist the webhook secret into the config table.
 * Overwrites any previously stored value (rotation).
 *
 * @param secret - The plaintext webhook secret to store
 */
export function setWebhookSecret(secret: string): void {
  const db = getDb()
  const encrypted = encrypt(secret)

  db.insert(configTable)
    .values({ key: WEBHOOK_SECRET_KEY, value: encrypted })
    .onConflictDoUpdate({
      target: configTable.key,
      set: { value: encrypted },
    })
    .run()
}

/**
 * Remove the stored webhook secret from the config table.
 */
export function clearWebhookSecret(): void {
  const db = getDb()
  db.delete(configTable).where(eq(configTable.key, WEBHOOK_SECRET_KEY)).run()
}
