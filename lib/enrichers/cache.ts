import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { enrichmentCache } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/**
 * Retrieve a cached value by key. Returns null on miss or expiry.
 *
 * Expiry is computed as: `fetched_at + ttl_sec` vs `NOW`.
 *
 * @param db - Drizzle database instance
 * @param key - Cache key (e.g. 'cve:CVE-2024-0001', 'socket:npm:lodash:4.17.21')
 * @returns Parsed value T or null if missing / expired
 */
export function cacheGet<T>(db: DB, key: string): T | null {
  const row = db
    .select()
    .from(enrichmentCache)
    .where(eq(enrichmentCache.key, key))
    .get()

  if (!row) return null

  const expiresAt = new Date(
    new Date(row.fetchedAt).getTime() + row.ttlSec * 1000,
  )

  if (expiresAt <= new Date()) return null

  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

/**
 * Store a value in the enrichment cache with a given TTL.
 *
 * Uses INSERT OR REPLACE (upsert by primary key) so calling `cacheSet`
 * on an existing key refreshes both the value and the TTL clock.
 *
 * @param db - Drizzle database instance
 * @param key - Cache key
 * @param value - Serialisable value to cache
 * @param ttlSec - Time-to-live in seconds
 */
export function cacheSet<T>(db: DB, key: string, value: T, ttlSec: number): void {
  const now = new Date().toISOString()
  const serialised = JSON.stringify(value)

  db.insert(enrichmentCache)
    .values({
      key,
      value: serialised,
      fetchedAt: now,
      ttlSec,
    })
    .onConflictDoUpdate({
      target: enrichmentCache.key,
      set: {
        value: serialised,
        fetchedAt: now,
        ttlSec,
      },
    })
    .run()
}
