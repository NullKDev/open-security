/**
 * @file lib/posture/mttr.ts
 *
 * MTTR (Mean Time To Remediate) computation and persistence.
 *
 * Uses ADR-7 row_number() window function approach for exact median.
 * Refreshes mttr_by_severity for 30/60/90 day windows.
 *
 * Design: ADR-4, ADR-7 (v0.4 design.md)
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

type SqliteClient = {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => void
  }
}

function getSqlite(db: DB): SqliteClient {
  return (db as unknown as { session: { client: SqliteClient } }).session.client
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface MttrDTO {
  projectId: string
  severity: string
  windowDays: number
  /** Median seconds to remediate; null when sampleSize = 0 */
  medianSeconds: number | null
  avgSeconds: number | null
  sampleSize: number
  /** ISO timestamp of last refresh */
  refreshedAt: string
  /** true when sampleSize < 5 (REQ-MT-04) */
  lowConfidence: boolean
}

// ─── Internals ────────────────────────────────────────────────────────────────

const WINDOWS = [30, 60, 90] as const

/**
 * Computes MTTR rows for a single project + window using ADR-7 SQL.
 * Returns one row per severity that has at least one remediated finding.
 */
function computeMttrForWindow(
  sqlite: SqliteClient,
  projectId: string,
  windowDays: number,
): Array<{ severity: string; median_seconds: number | null; avg_seconds: number | null; sample_size: number }> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString()

  // ADR-7 SQL: exact median via row_number() window function
  const rows = sqlite.prepare(`
    WITH durations AS (
      SELECT
        f.severity,
        CAST(
          (julianday(fb.merged_at) - julianday(f.first_detected_at)) * 86400
          AS INTEGER
        ) AS dur_seconds
      FROM findings f
      JOIN finding_branches fb ON fb.finding_id = f.id
      JOIN scans s ON s.id = f.scan_id
      WHERE fb.merged_at IS NOT NULL
        AND fb.merged_at >= ?
        AND s.project_id = ?
        AND f.first_detected_at IS NOT NULL
    ),
    ranked AS (
      SELECT
        severity,
        dur_seconds,
        row_number() OVER (PARTITION BY severity ORDER BY dur_seconds) AS rn,
        count(*)    OVER (PARTITION BY severity) AS n
      FROM durations
    )
    SELECT
      severity,
      AVG(CASE WHEN rn IN ((n + 1) / 2, (n + 2) / 2) THEN dur_seconds END) AS median_seconds,
      AVG(dur_seconds) AS avg_seconds,
      MAX(n) AS sample_size
    FROM ranked
    GROUP BY severity
  `).all(windowStart, projectId) as Array<{
    severity: string
    median_seconds: number | null
    avg_seconds: number | null
    sample_size: number
  }>

  return rows
}

/**
 * Refreshes the mttr_by_severity table for a project.
 * Computes MTTR for 30, 60, and 90 day windows.
 * Upserts one row per (projectId, severity, windowDays).
 *
 * @param db - Drizzle database instance
 * @param projectId - The project to refresh MTTR for
 */
export function refreshMttr(db: DB, projectId: string): void {
  const sqlite = getSqlite(db)
  const refreshedAt = new Date().toISOString()

  for (const windowDays of WINDOWS) {
    const computedRows = computeMttrForWindow(sqlite, projectId, windowDays)

    if (computedRows.length === 0) {
      // No remediated findings in this window — still upsert zero rows for all known severities
      // so the API can return consistent shape. But only do this if there's already something in the table.
      // For simplicity: if no data, skip — the caller gets an empty getMttr() result.
      continue
    }

    for (const row of computedRows) {
      sqlite.prepare(`
        INSERT INTO mttr_by_severity
          (project_id, severity, window_days, median_seconds, avg_seconds, sample_size, refreshed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, severity, window_days) DO UPDATE SET
          median_seconds = excluded.median_seconds,
          avg_seconds = excluded.avg_seconds,
          sample_size = excluded.sample_size,
          refreshed_at = excluded.refreshed_at
      `).run(
        projectId,
        row.severity,
        windowDays,
        row.median_seconds ?? null,
        row.avg_seconds ?? null,
        row.sample_size ?? 0,
        refreshedAt,
      )
    }
  }
}

/**
 * Returns all MTTR rows for a project from the mttr_by_severity table.
 * Includes lowConfidence = (sampleSize < 5) flag per REQ-MT-04.
 *
 * @param db - Drizzle database instance
 * @param projectId - The project to query
 * @returns Array of MttrDTOs ordered by severity, windowDays
 */
export function getMttr(db: DB, projectId: string): MttrDTO[] {
  const sqlite = getSqlite(db)

  const rows = sqlite.prepare(`
    SELECT
      project_id,
      severity,
      window_days,
      median_seconds,
      avg_seconds,
      sample_size,
      refreshed_at
    FROM mttr_by_severity
    WHERE project_id = ?
    ORDER BY severity, window_days
  `).all(projectId) as Array<{
    project_id: string
    severity: string
    window_days: number
    median_seconds: number | null
    avg_seconds: number | null
    sample_size: number
    refreshed_at: string
  }>

  return rows.map((r) => ({
    projectId: r.project_id,
    severity: r.severity,
    windowDays: r.window_days,
    medianSeconds: r.median_seconds,
    avgSeconds: r.avg_seconds,
    sampleSize: r.sample_size,
    refreshedAt: r.refreshed_at,
    lowConfidence: r.sample_size < 5,
  }))
}
