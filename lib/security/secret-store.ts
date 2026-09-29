/**
 * lib/security/secret-store.ts
 *
 * AES-256-GCM encrypted credential store backed by the SQLite `secrets` table.
 * Key is derived via `deriveMachineKey()` from machine identity.
 *
 * Ciphertext format: base64(iv[12] ‖ authTag[16] ‖ encrypted_bytes)
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type Database from 'better-sqlite3'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12   // 96-bit nonce recommended for GCM
const TAG_LENGTH = 16  // 128-bit auth tag

/**
 * Encrypt a UTF-8 plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param keyBytes - 32-byte key material (Uint8Array)
 * @returns base64-encoded ciphertext blob: base64(iv ‖ authTag ‖ ciphertext)
 */
export async function encryptValue(plaintext: string, keyBytes: Uint8Array): Promise<string> {
  const iv = randomBytes(IV_LENGTH)
  const keyBuf = Buffer.from(keyBytes)
  const cipher = createCipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LENGTH })

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Layout: iv (12) ‖ authTag (16) ‖ encrypted (N)
  const blob = Buffer.concat([iv, authTag, encrypted])
  return blob.toString('base64')
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext blob.
 *
 * @param ciphertext - base64-encoded blob from encryptValue
 * @param keyBytes - 32-byte key material (Uint8Array)
 * @returns Original UTF-8 plaintext
 * @throws If the ciphertext is tampered or the key is wrong
 */
export async function decryptValue(ciphertext: string, keyBytes: Uint8Array): Promise<string> {
  const blob = Buffer.from(ciphertext, 'base64')

  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext blob too short — corrupted or invalid')
  }

  const iv = blob.subarray(0, IV_LENGTH)
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = blob.subarray(IV_LENGTH + TAG_LENGTH)

  const keyBuf = Buffer.from(keyBytes)
  const decipher = createDecipheriv(ALGO, keyBuf, iv, { authTagLength: TAG_LENGTH })
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return decrypted.toString('utf-8')
}

// ─── SecretStore interface ─────────────────────────────────────────────────────

/**
 * A typed handle to the encrypted credential store for a given DB + key pair.
 */
export interface SecretStore {
  /**
   * Store an encrypted secret under the given key.
   * Overwrites any existing value for that key.
   *
   * @param key - Logical name for the credential (e.g. 'jira.api_token')
   * @param plaintext - The plaintext secret value to encrypt and store
   */
  set(key: string, plaintext: string): Promise<void>

  /**
   * Retrieve and decrypt a secret by key.
   *
   * @param key - Logical name for the credential
   * @returns Decrypted plaintext, or null if the key does not exist
   */
  get(key: string): Promise<string | null>

  /**
   * Remove a secret from the store.
   * No-op if the key does not exist.
   *
   * @param key - Logical name for the credential to remove
   */
  delete(key: string): Promise<void>
}

/**
 * Create a SecretStore backed by the given SQLite database and encryption key.
 *
 * @param db - better-sqlite3 Database instance with the `secrets` table present
 * @param keyBytes - 32-byte AES-256-GCM key material
 * @returns SecretStore instance
 */
export function createSecretStore(db: Database.Database, keyBytes: Uint8Array): SecretStore {
  return {
    async set(key: string, plaintext: string): Promise<void> {
      const ciphertext = await encryptValue(plaintext, keyBytes)
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO secrets (key, ciphertext, algo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext,
                                        algo = excluded.algo,
                                        updated_at = excluded.updated_at`
      ).run(key, ciphertext, ALGO, now, now)
    },

    async get(key: string): Promise<string | null> {
      const row = db.prepare(
        `SELECT ciphertext FROM secrets WHERE key = ?`
      ).get(key) as { ciphertext: string } | undefined

      if (!row) return null
      return decryptValue(row.ciphertext, keyBytes)
    },

    async delete(key: string): Promise<void> {
      db.prepare(`DELETE FROM secrets WHERE key = ?`).run(key)
    },
  }
}
