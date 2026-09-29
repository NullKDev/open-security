/**
 * tests/unit/enrichers/cache.test.ts
 *
 * TDD RED → GREEN: T-016 + T-017 — enrichment cache
 *
 * Covers:
 * - cacheGet returns null on miss
 * - cacheGet returns null when TTL has expired
 * - cacheSet + cacheGet within TTL returns value
 * - past-TTL record returns null
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { cacheGet, cacheSet } from '@/lib/enrichers/cache'

describe('enrichment cache', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  describe('cacheGet', () => {
    it('returns null on cache miss', () => {
      const result = cacheGet<{ score: number }>(db, 'osv:npm:lodash:4.17.21')
      expect(result).toBeNull()
    })

    it('returns null when TTL has expired', () => {
      // Insert a record with a fetched_at in the past and ttl of 1 second
      const pastTs = new Date(Date.now() - 5000).toISOString()
      db.run(`
        INSERT INTO enrichment_cache (key, value, fetched_at, ttl_sec)
        VALUES ('expired-key', '{"score":1}', '${pastTs}', 1)
      `)

      const result = cacheGet<{ score: number }>(db, 'expired-key')
      expect(result).toBeNull()
    })

    it('returns null for an unrelated key', () => {
      cacheSet(db, 'key-a', { x: 1 }, 3600)
      expect(cacheGet(db, 'key-b')).toBeNull()
    })
  })

  describe('cacheSet + cacheGet', () => {
    it('returns stored value when within TTL', () => {
      const payload = { epss: 0.42, ghsa: 'GHSA-xxxx-yyyy-zzzz' }
      cacheSet(db, 'cve:CVE-2024-0001', payload, 86400)

      const result = cacheGet<typeof payload>(db, 'cve:CVE-2024-0001')
      expect(result).not.toBeNull()
      expect(result!.epss).toBe(0.42)
      expect(result!.ghsa).toBe('GHSA-xxxx-yyyy-zzzz')
    })

    it('overwrites existing cache entry on re-set', () => {
      cacheSet(db, 'cve:CVE-2024-0002', { score: 1 }, 86400)
      cacheSet(db, 'cve:CVE-2024-0002', { score: 99 }, 86400)

      const result = cacheGet<{ score: number }>(db, 'cve:CVE-2024-0002')
      expect(result!.score).toBe(99)
    })

    it('past-TTL record returns null even with data present', () => {
      // Set then manually expire
      cacheSet(db, 'socket:npm:express:4.18.0', { alerts: ['malware'] }, 1)

      // Backdate fetched_at to make it stale
      const pastTs = new Date(Date.now() - 5000).toISOString()
      db.run(
        `UPDATE enrichment_cache SET fetched_at = '${pastTs}' WHERE key = 'socket:npm:express:4.18.0'`,
      )

      const result = cacheGet<{ alerts: string[] }>(db, 'socket:npm:express:4.18.0')
      expect(result).toBeNull()
    })
  })
})
