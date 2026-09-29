/**
 * tests/unit/repos/github-settings.test.ts
 *
 * Tests for webhook secret storage via AES-256-GCM encrypted config table.
 * Verifies: roundtrip encrypt/decrypt, get/set/clear, rotation, null on missing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

// ─── Mock getDb so all crypto/repo calls use an in-memory DB ─────────────────
let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

import { getWebhookSecret, setWebhookSecret, clearWebhookSecret } from '@/lib/repos/github-settings.repo'
import { encrypt, decrypt } from '@/lib/crypto/webhook-secret'

describe('webhook-secret crypto', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
  })

  it('encrypt/decrypt roundtrip returns original plaintext', () => {
    const plaintext = 'super-secret-abc123'
    const enc = encrypt(plaintext)
    expect(enc).not.toBe(plaintext)
    expect(decrypt(enc)).toBe(plaintext)
  })

  it('each encrypt call produces a different ciphertext (random IV)', () => {
    const plaintext = 'same-input'
    const enc1 = encrypt(plaintext)
    const enc2 = encrypt(plaintext)
    expect(enc1).not.toBe(enc2)
    // Both must still decrypt to the same value
    expect(decrypt(enc1)).toBe(plaintext)
    expect(decrypt(enc2)).toBe(plaintext)
  })

  it('decrypt returns null for garbage input', () => {
    expect(decrypt('not-valid-base64!!!')).toBeNull()
  })

  it('decrypt returns null for tampered ciphertext', () => {
    const enc = encrypt('hello')
    // Corrupt one byte in the base64 string
    const tampered = enc.slice(0, -4) + 'XXXX'
    expect(decrypt(tampered)).toBeNull()
  })
})

describe('github-settings.repo', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
  })

  it('getWebhookSecret returns null when no secret is stored', () => {
    expect(getWebhookSecret()).toBeNull()
  })

  it('setWebhookSecret stores the secret and getWebhookSecret retrieves it', () => {
    setWebhookSecret('my-webhook-secret')
    const retrieved = getWebhookSecret()
    expect(retrieved).toBe('my-webhook-secret')
  })

  it('setWebhookSecret rotation overwrites the previous value', () => {
    setWebhookSecret('old-secret')
    setWebhookSecret('new-secret')
    expect(getWebhookSecret()).toBe('new-secret')
  })

  it('clearWebhookSecret removes the stored secret', () => {
    setWebhookSecret('to-be-cleared')
    clearWebhookSecret()
    expect(getWebhookSecret()).toBeNull()
  })

  it('stored value is not plaintext (encrypted at rest)', async () => {
    const { eq } = await import('drizzle-orm')
    const { config: configTable } = await import('@/lib/db/schema')

    setWebhookSecret('plaintext-value')

    const row = testDb
      .select()
      .from(configTable)
      .where(eq(configTable.key, 'webhook_secret_encrypted'))
      .get()

    expect(row).toBeDefined()
    // The raw stored value must not be equal to the plaintext
    expect(row!.value).not.toBe('plaintext-value')
    // It must be a valid base64 string (the encrypted envelope)
    expect(() => Buffer.from(row!.value, 'base64')).not.toThrow()
  })
})
