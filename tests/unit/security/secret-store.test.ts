/**
 * tests/unit/security/secret-store.test.ts
 *
 * TDD RED → GREEN: T-005 + T-006 — secret-store
 *
 * Covers:
 * - encrypt/decrypt round-trip produces the original plaintext
 * - Different plaintexts produce different ciphertexts
 * - Tampered ciphertext throws on decrypt
 * - set/get persists through the SQLite secrets table
 * - get returns null for missing keys
 * - delete removes the key
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSecretStore, encryptValue, decryptValue } from '@/lib/security/secret-store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const migrationFiles = [
  '0000_glossy_the_hand.sql',
  '0001_scan_events.sql',
  '0002_scan_tree.sql',
  '0003_scan_mode.sql',
  '0004_orchestrated_scan_modes.sql',
  '0005_project_models_config.sql',
  '0006_fix_context.sql',
  '0007_v01_dedup_enrichment.sql',
  '0008_v01_fts5.sql',
  '0009_v02_diff_watch_sarif.sql',
  '0010_v03_new_tables.sql',
  '0011_v03_alter_tables.sql',
  '0012_v04_prove_and_measure.sql',
  '0013_v1_0.sql',
]

function stripBreakpoints(sql: string): string {
  return sql.replace(/--> statement-breakpoint/g, '')
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const f of migrationFiles) {
    const sql = readFileSync(join(process.cwd(), 'drizzle', f), 'utf-8')
    db.exec(stripBreakpoints(sql))
  }
  return db
}

/** Fixed 32-byte test key */
const TEST_KEY = new Uint8Array(32).fill(0x42)

// ─── encryptValue / decryptValue ──────────────────────────────────────────────

describe('encryptValue / decryptValue', () => {
  it('round-trips plaintext through encrypt → decrypt', async () => {
    const plaintext = 'super-secret-token'
    const ciphertext = await encryptValue(plaintext, TEST_KEY)
    const result = await decryptValue(ciphertext, TEST_KEY)
    expect(result).toBe(plaintext)
  })

  it('different plaintexts produce different ciphertexts', async () => {
    const ct1 = await encryptValue('secret-a', TEST_KEY)
    const ct2 = await encryptValue('secret-b', TEST_KEY)
    expect(ct1).not.toBe(ct2)
  })

  it('same plaintext produces different ciphertexts (random IV)', async () => {
    const ct1 = await encryptValue('same-value', TEST_KEY)
    const ct2 = await encryptValue('same-value', TEST_KEY)
    // Should differ due to random IV
    expect(ct1).not.toBe(ct2)
    // But both decrypt to the same value
    const dec1 = await decryptValue(ct1, TEST_KEY)
    const dec2 = await decryptValue(ct2, TEST_KEY)
    expect(dec1).toBe(dec2)
  })

  it('tampered ciphertext throws on decrypt', async () => {
    const ciphertext = await encryptValue('my-secret', TEST_KEY)
    // Tamper with the ciphertext by altering a character in the middle
    const buf = Buffer.from(ciphertext, 'base64')
    buf[buf.length - 5] ^= 0xff
    const tampered = buf.toString('base64')
    await expect(decryptValue(tampered, TEST_KEY)).rejects.toThrow()
  })

  it('wrong key throws on decrypt', async () => {
    const ciphertext = await encryptValue('my-secret', TEST_KEY)
    const wrongKey = new Uint8Array(32).fill(0x01)
    await expect(decryptValue(ciphertext, wrongKey)).rejects.toThrow()
  })
})

// ─── createSecretStore — set / get / delete ───────────────────────────────────

describe('createSecretStore', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('set and get round-trips a string value', async () => {
    const store = createSecretStore(db, TEST_KEY)
    await store.set('jira.api_token', 'my-jira-token-123')
    const result = await store.get('jira.api_token')
    expect(result).toBe('my-jira-token-123')
  })

  it('get returns null for a missing key', async () => {
    const store = createSecretStore(db, TEST_KEY)
    const result = await store.get('nonexistent.key')
    expect(result).toBeNull()
  })

  it('set overwrites an existing key', async () => {
    const store = createSecretStore(db, TEST_KEY)
    await store.set('slack.webhook', 'old-webhook-url')
    await store.set('slack.webhook', 'new-webhook-url')
    const result = await store.get('slack.webhook')
    expect(result).toBe('new-webhook-url')
  })

  it('delete removes the key — get returns null afterwards', async () => {
    const store = createSecretStore(db, TEST_KEY)
    await store.set('github.pat', 'ghp_token123')
    await store.delete('github.pat')
    const result = await store.get('github.pat')
    expect(result).toBeNull()
  })

  it('deleting a nonexistent key does not throw', async () => {
    const store = createSecretStore(db, TEST_KEY)
    await expect(store.delete('nonexistent.key')).resolves.not.toThrow()
  })

  it('multiple keys are stored independently', async () => {
    const store = createSecretStore(db, TEST_KEY)
    await store.set('key-a', 'value-a')
    await store.set('key-b', 'value-b')
    expect(await store.get('key-a')).toBe('value-a')
    expect(await store.get('key-b')).toBe('value-b')
  })
})
