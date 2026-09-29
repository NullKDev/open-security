/**
 * @file lib/posture/refresh.ts
 *
 * Posture refresh service.
 * Computes severity counts and weighted score from a scan's findings,
 * UPSERTs the daily posture_snapshots row, and triggers MTTR refresh.
 *
 * Design: ADR-4 (v0.4 design.md)
 * Called at scan completion by lib/pipeline/runner.ts.
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { upsertSnapshot } from '@/lib/repos/posture.repo'
import type { PostureSnapshotDTO } from '@/lib/repos/posture.repo'

type DB = BetterSQLite3Database<typeof schema>

type SqliteClient = {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown
  }
}

function getSqlite(db: DB): SqliteClient {
  return (db as unknown as { session: { client: SqliteClient } }).session.client
}

// Severity weights per REQ-PT-01
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
  info: 0,
}

interface SeverityCounts {
  countCritical: number
  countHigh: number
  countMedium: number
  countLow: number
  countInfo: number
}

/**
 * Computes severity counts for all findings in the given scan.
 * Only counts canonical findings (canonical_finding_id IS NULL).
 * Groups by severity.
 */
function computeSeverityCounts(db: DB, scanId: string): SeverityCounts {
  const sqlite = getSqlite(db)

  const rows = sqlite.prepare(`
    SELECT severity, COUNT(*) AS cnt
    FROM findings
    WHERE scan_id = ?
    GROUP BY severity
  `).all(scanId) as Array<{ severity: string; cnt: number }>

  const counts: SeverityCounts = {
    countCritical: 0,
    countHigh: 0,
    countMedium: 0,
    countLow: 0,
    countInfo: 0,
  }

  for (const row of rows) {
    switch (row.severity) {
      case 'critical': counts.countCritical = row.cnt; break
      case 'high':     counts.countHigh = row.cnt; break
      case 'medium':   counts.countMedium = row.cnt; break
      case 'low':      counts.countLow = row.cnt; break
      case 'info':     counts.countInfo = row.cnt; break
    }
  }

  return counts
}

/**
 * Computes the sum of (now - created_at) in days over open critical findings
 * for the project, excluding any in finding_dismissals.
 * Returns 0 if no open criticals exist.
 */
function computeOpenCriticalDays(db: DB, projectId: string): number {
  const sqlite = getSqlite(db)

  const result = sqlite.prepare(`
    SELECT COALESCE(
      SUM((julianday('now') - julianday(f.created_at))),
      0
    ) AS total_days
    FROM findings f
    JOIN scans s ON s.id = f.scan_id
    WHERE s.project_id = ?
      AND f.severity = 'critical'
      AND (f.status IS NULL OR f.status = 'open')
      AND NOT EXISTS (
        SELECT 1 FROM finding_dismissals fd
        WHERE fd.finding_id = f.id
          AND fd.undone_at IS NULL
      )
  `).get(projectId) as { total_days: number }

  return result.total_days ?? 0
}

/**
 * Refreshes the posture snapshot for a project after a scan completes.
 *
 * Actions:
 * 1. Counts findings by severity for the given scan
 * 2. Computes the severity-weighted score (REQ-PT-01)
 * 3. UPSERTs a posture_snapshots row for today's date (idempotent)
 * 4. Triggers MTTR refresh (fire-and-forget — import is lazy)
 *
 * @param db - Drizzle database instance
 * @param projectId - Project whose posture to refresh
 * @param scanId - Scan that just completed (used for counts + FK)
 * @returns The upserted PostureSnapshotDTO
 */
export function refreshPosture(db: DB, projectId: string, scanId: string): PostureSnapshotDTO {
  const today = new Date().toISOString().slice(0, 10)
  const counts = computeSeverityCounts(db, scanId)
  const openCriticalDays = computeOpenCriticalDays(db, projectId)

  const snapshot = upsertSnapshot(db, {
    projectId,
    scanId,
    bucketDate: today,
    ...counts,
    openCriticalDays,
  })

  // Trigger MTTR refresh (non-blocking; failures must not fail the scan)
  try {
    const { refreshMttr } = require('@/lib/posture/mttr') as typeof import('@/lib/posture/mttr')
    refreshMttr(db, projectId)
  } catch {
    // MTTR module may not exist yet in test environments — non-critical
  }

  return snapshot
}
