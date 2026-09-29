import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findingTimelines, findings } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import type { CommitInfo } from '@/lib/timeline/git-log-parser'

type DB = BetterSQLite3Database<typeof schema>

/** A finding timeline row as returned from the database. */
export interface FindingTimeline {
  id: string
  findingId: string
  commits: CommitInfo[]
  suspectedDeploys: number
  partial: boolean
  computedAt: string | null
}

/** Input for creating or updating a finding timeline. */
export interface UpsertFindingTimelineInput {
  id: string
  commits: CommitInfo[]
  suspectedDeploys: number
  partial: boolean
}

/**
 * Inserts or updates a finding timeline row.
 * On conflict by the unique findingId, replaces commits and metadata.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding this timeline belongs to
 * @param input - Timeline data including commits, suspected deploys, and partial flag
 */
export function upsertFindingTimeline(
  db: DB,
  findingId: string,
  input: UpsertFindingTimelineInput,
): void {
  const now = new Date().toISOString()
  const commitsJson = JSON.stringify(input.commits)

  db.insert(findingTimelines)
    .values({
      id: input.id,
      findingId,
      commits: commitsJson,
      suspectedDeploys: input.suspectedDeploys,
      partial: input.partial ? 1 : 0,
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: findingTimelines.findingId,
      set: {
        commits: commitsJson,
        suspectedDeploys: input.suspectedDeploys,
        partial: input.partial ? 1 : 0,
        computedAt: now,
      },
    })
    .run()
}

/**
 * Returns the timeline for a given finding, or null if none exists.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding to look up
 * @returns FindingTimeline or null
 */
export function findTimelineByFindingId(
  db: DB,
  findingId: string,
): FindingTimeline | null {
  const row = db
    .select()
    .from(findingTimelines)
    .where(eq(findingTimelines.findingId, findingId))
    .get()

  if (!row) return null

  return {
    id: row.id,
    findingId: row.findingId,
    commits: JSON.parse(row.commits) as CommitInfo[],
    suspectedDeploys: row.suspectedDeploys,
    partial: Boolean(row.partial),
    computedAt: row.computedAt ?? null,
  }
}

/**
 * Invalidates the timeline for a finding by setting `timeline_computed_at = null`
 * on the findings row. Used to signal that the timeline needs to be recomputed.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding whose timeline should be invalidated
 */
export function invalidateTimeline(db: DB, findingId: string): void {
  db.update(findings)
    .set({ timelineComputedAt: null })
    .where(eq(findings.id, findingId))
    .run()
}
