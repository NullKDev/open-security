import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { runMigrations } from './migrate'
import { runDedupeBackfill } from '@/lib/dedup/backfill'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * Production singleton. Creates the SQLite database at .obt/db.sqlite,
 * runs pending migrations, runs dedup backfill (idempotent), and returns
 * the drizzle ORM wrapper.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) return _db

  mkdirSync('.obt', { recursive: true })

  const sqlite = new Database('.obt/db.sqlite')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  runMigrations(sqlite)

  _db = drizzle(sqlite, { schema })

  // Run dedup backfill after migrations (idempotent — skips if already done)
  runDedupeBackfill(_db)

  return _db
}

/**
 * Create a drizzle instance backed by an in-memory SQLite database.
 * Runs migrations against the in-memory instance.
 * Intended for testing.
 */
export function createTestDb(
  sqlite: Database.Database = new Database(':memory:'),
) {
  runMigrations(sqlite)
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}
