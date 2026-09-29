import { and, desc, eq, max } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings, scans } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export type ScanStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'timeout'

export type ScanMode = 'quick' | 'standard' | 'intermediate' | 'paranoid'

/** v0.2: scan strategy — standard modes plus diff */
export type ScanStrategy = ScanMode | 'diff'

export interface ScanDTO {
  id: string
  projectId: string
  parentId: string | null
  version: number
  prompt: string | null
  scanMode: ScanMode
  /** v0.2: scan strategy (default: 'standard') */
  strategy: ScanStrategy
  /** v0.2: base commit SHA (diff scans only) */
  baseSha: string | null
  /** v0.2: head commit SHA (diff scans only) */
  headSha: string | null
  /** v0.2: GitHub PR number that triggered this diff scan */
  prNumber: number | null
  /** v0.2: status of PR comment creation */
  prCommentStatus: string | null
  status: ScanStatus
  stage: string | null
  startedAt: string | null
  finishedAt: string | null
  modelsUsed: string | null
  error: string | null
  projectMap: string | null
}

/** v0.2: DTO for a finding row (minimal — just the fields delta needs) */
export interface FindingDeltaDTO {
  id: string
  scanId: string
  detector: string
  severity: string
  confidence: number
  title: string
  locationPath: string
  locationLineStart: number
  dedupKey: string | null
}

export interface CreateScanInput {
  projectId: string
  parentId?: string
  prompt?: string
  scanMode?: ScanMode
  /** v0.2: strategy; defaults to 'standard' */
  strategy?: ScanStrategy
  /** v0.2: base commit SHA (diff scans only) */
  baseSha?: string
  /** v0.2: head commit SHA (diff scans only) */
  headSha?: string
  /** v0.2: GitHub PR number */
  prNumber?: number
}

function uuid(): string {
  return crypto.randomUUID()
}

function nextVersion(db: DB, projectId: string): number {
  const result = db
    .select({ maxVersion: max(scans.version) })
    .from(scans)
    .where(eq(scans.projectId, projectId))
    .get()
  return (result?.maxVersion ?? 0) + 1
}

export function createScan(db: DB, input: CreateScanInput): ScanDTO {
  const id = uuid()
  const version = nextVersion(db, input.projectId)
  const scanMode = input.scanMode ?? 'standard'
  const strategy = input.strategy ?? 'standard'

  db.insert(scans).values({
    id,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    version,
    prompt: input.prompt ?? null,
    scanMode,
    strategy,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    prNumber: input.prNumber ?? null,
    status: 'pending',
  }).run()

  return {
    id,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    version,
    prompt: input.prompt ?? null,
    scanMode,
    strategy,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    prNumber: input.prNumber ?? null,
    prCommentStatus: null,
    status: 'pending',
    stage: null,
    startedAt: null,
    finishedAt: null,
    modelsUsed: null,
    error: null,
    projectMap: null,
  }
}

export function setProjectMap(db: DB, scanId: string, json: string): void {
  db.update(scans).set({ projectMap: json }).where(eq(scans.id, scanId)).run()
}

export function getScanById(db: DB, id: string): ScanDTO | undefined {
  const row = db.select().from(scans).where(eq(scans.id, id)).get()
  if (!row) return undefined
  return rowToDTO(row)
}

export function listScansByProject(db: DB, projectId: string): ScanDTO[] {
  const rows = db.select().from(scans).where(eq(scans.projectId, projectId)).all()
  return rows.map(rowToDTO)
}

export function listScanChildren(db: DB, parentId: string): ScanDTO[] {
  const rows = db.select().from(scans).where(eq(scans.parentId, parentId)).all()
  return rows.map(rowToDTO)
}

export function updateScanStatus(
  db: DB,
  id: string,
  status: ScanStatus,
  error?: string,
): ScanDTO {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status }

  if (status === 'running') {
    updateData.startedAt = now
  }
  if (status === 'done' || status === 'failed' || status === 'cancelled') {
    updateData.finishedAt = now
  }
  if (status === 'failed' && error !== undefined) {
    updateData.error = error
  }

  db.update(scans).set(updateData).where(eq(scans.id, id)).run()

  const row = db.select().from(scans).where(eq(scans.id, id)).get()
  if (!row) throw new Error(`Scan ${id} not found after update`)
  return rowToDTO(row)
}

function rowToDTO(row: typeof scans.$inferSelect): ScanDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId ?? null,
    version: row.version,
    prompt: row.prompt ?? null,
    scanMode: (row.scanMode ?? 'standard') as ScanMode,
    strategy: (row.strategy ?? 'standard') as ScanStrategy,
    baseSha: row.baseSha ?? null,
    headSha: row.headSha ?? null,
    prNumber: row.prNumber ?? null,
    prCommentStatus: row.prCommentStatus ?? null,
    status: row.status as ScanStatus,
    stage: row.stage ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    modelsUsed: row.modelsUsed ?? null,
    error: row.error ?? null,
    projectMap: row.projectMap ?? null,
  }
}

/**
 * Return the most recent completed scan for a project.
 * Used by diff scans to establish their parent baseline.
 *
 * @param db - Drizzle database instance
 * @param projectId - project to query
 * @returns ScanDTO or null if no completed scan exists
 */
export function getMostRecentCompletedScan(db: DB, projectId: string): ScanDTO | null {
  // Order by version DESC — version is a monotonically increasing integer, so it's
  // reliable even when finishedAt timestamps share the same millisecond.
  const row = db
    .select()
    .from(scans)
    .where(and(eq(scans.projectId, projectId), eq(scans.status, 'done')))
    .orderBy(desc(scans.version))
    .limit(1)
    .get()

  return row ? rowToDTO(row) : null
}

/**
 * Compute delta findings: findings in childScanId whose dedup_key does NOT
 * appear in any finding of parentScanId.
 *
 * This is the core no-op guard for diff scans: if all child findings share
 * a dedup_key with the parent, the returned array will be empty.
 *
 * @param db - Drizzle database instance
 * @param childScanId - the diff scan to evaluate
 * @param parentScanId - the baseline scan to subtract
 * @returns array of net-new FindingDeltaDTO rows
 */
export function getDeltaFindings(
  db: DB,
  childScanId: string,
  parentScanId: string,
): FindingDeltaDTO[] {
  // Drizzle doesn't support correlated subqueries easily with SQLite, so we
  // use two flat queries and compute the set difference in application memory.
  // This is safe: findings per scan are bounded by scan scope.
  const childRows = db
    .select()
    .from(findings)
    .where(eq(findings.scanId, childScanId))
    .all()

  const parentKeys = new Set(
    db
      .select({ dk: findings.dedupKey })
      .from(findings)
      .where(eq(findings.scanId, parentScanId))
      .all()
      .map((r) => r.dk)
      .filter((k): k is string => k !== null && k !== undefined),
  )

  return childRows
    .filter((r) => r.dedupKey === null || !parentKeys.has(r.dedupKey))
    .map((r) => ({
      id: r.id,
      scanId: r.scanId,
      detector: r.detector,
      severity: r.severity,
      confidence: r.confidence,
      title: r.title,
      locationPath: r.locationPath,
      locationLineStart: r.locationLineStart,
      dedupKey: r.dedupKey ?? null,
    }))
}
