import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { playbooks } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/** A playbook row as stored and returned from the database. */
export interface PlaybookRow {
  id: string
  name: string
  version: string
  description: string | null
  promptTemplate: string
  scannerScope: string | null
  parameters: string | null
  source: string
  builtIn: number
  trusted: number
  createdAt: string
}

/**
 * Returns all playbooks (builtin and user-created) ordered by creation time.
 *
 * @param db - Drizzle database instance
 * @returns Array of PlaybookRow
 */
export function listPlaybooks(db: DB): PlaybookRow[] {
  const rows = db.select().from(playbooks).all()

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description ?? null,
    promptTemplate: row.promptTemplate,
    scannerScope: row.scannerScope ?? null,
    parameters: row.parameters ?? null,
    source: row.source,
    builtIn: row.builtIn,
    trusted: row.trusted,
    createdAt: row.createdAt,
  }))
}

/**
 * Inserts or replaces a playbook row.
 * On conflict by primary key (id), replaces the existing row entirely.
 *
 * @param db - Drizzle database instance
 * @param data - Playbook data to insert or replace
 */
export function upsertPlaybook(db: DB, data: PlaybookRow): void {
  db.insert(playbooks)
    .values({
      id: data.id,
      name: data.name,
      version: data.version,
      description: data.description ?? null,
      promptTemplate: data.promptTemplate,
      scannerScope: data.scannerScope ?? null,
      parameters: data.parameters ?? null,
      source: data.source,
      builtIn: data.builtIn,
      trusted: data.trusted,
      createdAt: data.createdAt,
    })
    .onConflictDoUpdate({
      target: playbooks.id,
      set: {
        name: data.name,
        version: data.version,
        description: data.description ?? null,
        promptTemplate: data.promptTemplate,
        scannerScope: data.scannerScope ?? null,
        parameters: data.parameters ?? null,
        source: data.source,
        builtIn: data.builtIn,
        trusted: data.trusted,
      },
    })
    .run()
}

/**
 * Deletes a playbook by id. No-op if the id does not exist.
 *
 * @param db - Drizzle database instance
 * @param id - Playbook id to delete
 */
export function deletePlaybook(db: DB, id: string): void {
  db.delete(playbooks).where(eq(playbooks.id, id)).run()
}
