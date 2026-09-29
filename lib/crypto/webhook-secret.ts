/**
 * lib/crypto/webhook-secret.ts
 *
 * AES-256-GCM encryption/decryption for the webhook secret.
 *
 * The encryption key is derived from a per-installation 32-byte random key
 * stored in the `config` table under the key `_crypto_key`. On first call the
 * key is generated and persisted. Subsequent calls retrieve the same key.
 *
 * Wire format (base64-encoded JSON): { iv: string, tag: string, ct: string }
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { config as configTable } from '@/lib/db/schema'

const ALGORITHM = 'aes-256-gcm'
const CONFIG_KEY = '_crypto_key'

interface EncryptedEnvelope {
  iv: string
  tag: string
  ct: string
}

/**
 * Retrieve or generate the 32-byte encryption key for this installation.
 * The key is stored as a hex string in the `config` table.
 *
 * @returns The 32-byte key as a Buffer
 */
function getOrCreateKey(): Buffer {
  const db = getDb()
  const row = db.select().from(configTable).where(eq(configTable.key, CONFIG_KEY)).get()

  if (row) {
    return Buffer.from(row.value, 'hex')
  }

  const key = randomBytes(32)
  db.insert(configTable)
    .values({ key: CONFIG_KEY, value: key.toString('hex') })
    .onConflictDoUpdate({ target: configTable.key, set: { value: key.toString('hex') } })
    .run()

  return key
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @returns Base64-encoded JSON envelope containing IV, auth tag, and ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getOrCreateKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  const tag = cipher.getAuthTag()

  const envelope: EncryptedEnvelope = {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: encrypted.toString('base64'),
  }

  return Buffer.from(JSON.stringify(envelope)).toString('base64')
}

/**
 * Decrypt a previously encrypted envelope produced by `encrypt`.
 *
 * @param encryptedBase64 - The base64-encoded JSON envelope
 * @returns The original plaintext string, or null on failure
 */
export function decrypt(encryptedBase64: string): string | null {
  try {
    const key = getOrCreateKey()
    const envelope = JSON.parse(
      Buffer.from(encryptedBase64, 'base64').toString('utf8'),
    ) as EncryptedEnvelope

    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    const ct = Buffer.from(envelope.ct, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    return null
  }
}
