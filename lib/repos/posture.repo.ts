/**
 * @file lib/repos/posture.repo.ts
 *
 * Repository for posture_snapshots and related posture metrics.
 * Implements: upsertSnapshot, getTimeseries, getHotspots, getRegressionRate.
 *
 * Design: ADR-4 (v0.4 design.md)
 */
import { eq, gte, asc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { postureSnapshots } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

// ─── Weights ──────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
  info: 0,
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface PostureSnapshotDTO {
  id: string
  projectId: string
  bucketDate: string
  countCritical: number
  countHigh: number
  countMedium: number
  countLow: number
  countInfo: number
  weightedScore: number
  openCriticalDays: number
  snapshotAt: string
  scanId: string | null
}

export interface UpsertSnapshotInput {
  projectId: string
  scanId?: string
  bucketDate: string
  countCritical?: number
  countHigh?: number
  countMedium?: number
  countLow?: number
  countInfo?: number
  openCriticalDays?: number
}

export interface HotspotDTO {
  filePath: string
  authorEmail: string | null
  distinctDedupKeys: number
  repeatOffender: boolean
}

export interface RegressionRateDTO {
  regressionCount30d: number
  totalFixes30d: number
  rate30d: number
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID()
}

function computeWeightedScore(counts: {
  countCritical: number
  countHigh: number
  countMedium: number
  countLow: number
  countInfo: number
}): number {
  return (
    counts.countCritical * SEVERITY_WEIGHTS.critical +
    counts.countHigh * SEVERITY_WEIGHTS.high +
    counts.countMedium * SEVERITY_WEIGHTS.medium +
    counts.countLow * SEVERITY_WEIGHTS.low +
    counts.countInfo * SEVERITY_WEIGHTS.info
  )
}

/**
 * Maps a raw SQLite row (snake_case) to PostureSnapshotDTO.
 * Raw SQL results use snake_case column names, not Drizzle's camelCase.
 */
function rowToDTO(row: Record<string, unknown>): PostureSnapshotDTO {
  return {
    id: row.id as string,
    projectId: (row.project_id ?? row.projectId) as string,
    bucketDate: (row.bucket_date ?? row.bucketDate) as string,
    countCritical: (row.count_critical ?? row.countCritical ?? 0) as number,
    countHigh: (row.count_high ?? row.countHigh ?? 0) as number,
    countMedium: (row.count_medium ?? row.countMedium ?? 0) as number,
    countLow: (row.count_low ?? row.countLow ?? 0) as number,
    countInfo: (row.count_info ?? row.countInfo ?? 0) as number,
    weightedScore: (row.weighted_score ?? row.weightedScore) as number,
    openCriticalDays: (row.open_critical_days ?? row.openCriticalDays ?? 0) as number,
    snapshotAt: (row.snapshot_at ?? row.snapshotAt) as string,
    scanId: ((row.scan_id ?? row.scanId) as string | null) ?? null,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Inserts or replaces the posture snapshot for a given (projectId, bucketDate) pair.
 * Multiple scans on the same day overwrite the row — last write wins for that day.
 * Computes weightedScore automatically from severity counts.
 *
 * @param db - Drizzle database instance
 * @param input - Snapshot data
 * @returns The upserted PostureSnapshotDTO
 */
export function upsertSnapshot(db: DB, input: UpsertSnapshotInput): PostureSnapshotDTO {
  const countCritical = input.countCritical ?? 0
  const countHigh = input.countHigh ?? 0
  const countMedium = input.countMedium ?? 0
  const countLow = input.countLow ?? 0
  const countInfo = input.countInfo ?? 0
  const weightedScore = computeWeightedScore({ countCritical, countHigh, countMedium, countLow, countInfo })
  const now = new Date().toISOString()

  // Use raw SQL for INSERT OR REPLACE to handle the UNIQUE(project_id, bucket_date) constraint
  const sqlite = (db as unknown as { session: { client: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown } } } }).session.client

  const id = uuid()

  sqlite.prepare(`
    INSERT INTO posture_snapshots
      (id, project_id, bucket_date, count_critical, count_high, count_medium,
       count_low, count_info, weighted_score, open_critical_days, snapshot_at, scan_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, bucket_date) DO UPDATE SET
      id = excluded.id,
      count_critical = excluded.count_critical,
      count_high = excluded.count_high,
      count_medium = excluded.count_medium,
      count_low = excluded.count_low,
      count_info = excluded.count_info,
      weighted_score = excluded.weighted_score,
      open_critical_days = excluded.open_critical_days,
      snapshot_at = excluded.snapshot_at,
      scan_id = excluded.scan_id
  `).run(
    id,
    input.projectId,
    input.bucketDate,
    countCritical,
    countHigh,
    countMedium,
    countLow,
    countInfo,
    weightedScore,
    input.openCriticalDays ?? 0,
    now,
    input.scanId ?? null,
  )

  const row = sqlite.prepare(`
    SELECT * FROM posture_snapshots
    WHERE project_id = ? AND bucket_date = ?
  `).get(input.projectId, input.bucketDate) as typeof postureSnapshots.$inferSelect

  return rowToDTO(row)
}

/**
 * Returns posture snapshots for a project ordered by bucketDate ascending.
 * When rangeDays > 0, filters to the last N calendar days.
 * When rangeDays = 0, returns all snapshots (no date filter).
 *
 * @param db - Drizzle database instance
 * @param projectId - The project to retrieve snapshots for
 * @param rangeDays - Number of days to look back (0 = all)
 * @returns Array of PostureSnapshotDTOs ordered by date
 */
export function getTimeseries(db: DB, projectId: string, rangeDays: number): PostureSnapshotDTO[] {
  const sqlite = (db as unknown as { session: { client: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } } }).session.client

  if (rangeDays === 0) {
    const rows = sqlite.prepare(`
      SELECT * FROM posture_snapshots
      WHERE project_id = ?
      ORDER BY bucket_date ASC
    `).all(projectId) as typeof postureSnapshots.$inferSelect[]

    return rows.map(rowToDTO)
  }

  const cutoffDate = new Date(Date.now() - rangeDays * 24 * 3600 * 1000).toISOString().slice(0, 10)

  const rows = sqlite.prepare(`
    SELECT * FROM posture_snapshots
    WHERE project_id = ? AND bucket_date >= ?
    ORDER BY bucket_date ASC
  `).all(projectId, cutoffDate) as typeof postureSnapshots.$inferSelect[]

  return rows.map(rowToDTO)
}

/**
 * Returns hotspot cells: files × authors with 3+ distinct dedup_keys.
 * Scoped to findings that belong to scans of the given project.
 * Results capped at 500 cells (ADR-4 risk mitigation).
 *
 * @param db - Drizzle database instance
 * @param projectId - The project to query
 * @returns Array of HotspotDTOs, capped at 500
 */
export function getHotspots(db: DB, projectId: string): HotspotDTO[] {
  const sqlite = (db as unknown as { session: { client: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } } }).session.client

  const rows = sqlite.prepare(`
    SELECT
      f.location_path AS file_path,
      c.author_email,
      COUNT(DISTINCT f.dedup_key) AS distinct_dedup_keys
    FROM findings f
    JOIN scans s ON s.id = f.scan_id
    LEFT JOIN commits c ON c.scan_id = f.scan_id
    WHERE s.project_id = ?
      AND f.dedup_key IS NOT NULL
      AND f.canonical_finding_id IS NULL
    GROUP BY f.location_path, c.author_email
    HAVING COUNT(DISTINCT f.dedup_key) >= 3
    ORDER BY distinct_dedup_keys DESC
    LIMIT 500
  `).all(projectId) as Array<{ file_path: string; author_email: string | null; distinct_dedup_keys: number }>

  return rows.map((r) => ({
    filePath: r.file_path,
    authorEmail: r.author_email,
    distinctDedupKeys: r.distinct_dedup_keys,
    repeatOffender: r.distinct_dedup_keys >= 3,
  }))
}

/**
 * Returns the regression rate for a project over a rolling window.
 * Rate = regressions / totalFixes (findings with merged_at in the window).
 * Returns rate=0 when totalFixes=0 to avoid division by zero.
 *
 * @param db - Drizzle database instance
 * @param projectId - The project to query
 * @param windowDays - Rolling window in days (e.g. 30)
 * @returns RegressionRateDTO
 */
export function getRegressionRate(db: DB, projectId: string, windowDays: number): RegressionRateDTO {
  const sqlite = (db as unknown as { session: { client: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } } }).session.client

  const cutoff = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString()

  const regressionResult = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM findings f
    JOIN scans s ON s.id = f.scan_id
    WHERE s.project_id = ?
      AND f.is_regression = 1
      AND f.created_at >= ?
  `).get(projectId, cutoff) as { cnt: number }

  const fixesResult = sqlite.prepare(`
    SELECT COUNT(*) AS cnt
    FROM findings f
    JOIN scans s ON s.id = f.scan_id
    JOIN finding_branches fb ON fb.finding_id = f.id
    WHERE s.project_id = ?
      AND fb.merged_at IS NOT NULL
      AND fb.merged_at >= ?
  `).get(projectId, cutoff) as { cnt: number }

  const regressionCount30d = regressionResult.cnt
  const totalFixes30d = fixesResult.cnt
  const rate30d = totalFixes30d > 0 ? regressionCount30d / totalFixes30d : 0

  return { regressionCount30d, totalFixes30d, rate30d }
}
