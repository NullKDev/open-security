import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const MIGRATIONS_TABLE = '__drizzle_migrations'

/**
 * Run SQL migrations idempotently. Tracks which migrations have been applied
 * in a `__drizzle_migrations` table, skipping already-executed files.
 */
export function runMigrations(sqlite: Database.Database, folder = './drizzle'): void {
  if (!existsSync(folder)) return

  // Ensure migrations tracking table exists
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name text PRIMARY KEY, executed_at text NOT NULL)`)

  const done = new Set(
    sqlite
      .prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
      .all()
      .map((r: unknown) => (r as { name: string }).name),
  )

  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let applied = 0
  for (const file of files) {
    if (done.has(file)) continue

    const sql = readFileSync(join(folder, file), 'utf-8')
    sqlite.exec(sql)
    sqlite
      .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name, executed_at) VALUES (?, ?)`)
      .run(file, new Date().toISOString())
    applied++
  }

  if (applied > 0) {
    console.log(`[db] Applied ${applied} migration(s)`)
  }
}
