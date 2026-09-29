import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface QueueRowDTO {
  id: string
  scanId: string
  projectId: string
  projectName: string
  detector: string
  severity: string
  title: string
  locationPath: string
  dedupKey: string | null
  occurrenceCount: number
  firstDetectedAt: string | null
  lastSeenAt: string | null
  cveIds: string[] | null
  patchDiff: string | null
  epssScore: number | null
  cisaKev: number
  daysOpen: number
  rankScore: number
  exploitability: number
}

export interface QueueQueryInput {
  cursor?: string | null
  limit?: number
  severity?: string[]
  projectId?: string[]
  hasPatch?: boolean
  kevOnly?: boolean
  status?: 'open' | 'dismissed'
}

export interface QueueResult {
  items: QueueRowDTO[]
  nextCursor: string | null
}

export interface QueueStats {
  total: number
  bySeverity: Record<string, number>
  byKev: number
  byPatch: number
}

function encodeCursor(id: string, rankScore: number): string {
  return Buffer.from(JSON.stringify({ id, rankScore })).toString('base64')
}

function decodeCursor(cursor: string): { id: string; rankScore: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
    if (typeof parsed.id === 'string' && typeof parsed.rankScore === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Returns a paginated, ranked list of canonical, non-dismissed findings.
 *
 * Ranking formula (per design §6):
 *   rank_score = exploitability × COALESCE(epss_score, 0.01)
 *                × (1 + 0.5 × cisa_kev)
 *                × ln(1 + days_open)
 *
 * Where:
 * - epss_score is the maximum EPSS score across all CVE IDs in the finding
 * - cisa_kev is 1 if any CVE ID is in the CISA KEV catalog, 0 otherwise
 * - days_open is derived from first_detected_at
 *
 * Findings with no EPSS data use 0.01. Dismissed findings (active
 * finding_dismissals with undone_at IS NULL) are excluded.
 *
 * @param db - Drizzle database instance
 * @param params - Query parameters (filters, pagination)
 * @returns Paginated queue result
 */
export function getQueue(db: DB, params: QueueQueryInput): QueueResult {
  const limit = Math.min(params.limit ?? 50, 100)

  let cursor: { id: string; rankScore: number } | null = null
  if (params.cursor) {
    cursor = decodeCursor(params.cursor)
  }

  // Build severity filter clause
  const severityClause = params.severity && params.severity.length > 0
    ? `AND f.severity IN (${params.severity.map(() => '?').join(',')})`
    : ''

  const severityValues = params.severity ?? []

  // Build project filter clause
  const projectClause = params.projectId && params.projectId.length > 0
    ? `AND sc.project_id IN (${params.projectId.map(() => '?').join(',')})`
    : ''

  const projectValues = params.projectId ?? []

  // Build hasPatch filter
  const patchClause = params.hasPatch === true ? 'AND f.patch_diff IS NOT NULL' : ''

  // Build kevOnly filter: restricts to findings with at least one KEV-listed CVE
  const kevOnlyClause = params.kevOnly === true
    ? `AND EXISTS (
        SELECT 1 FROM json_each(f.cve_ids) AS je
        JOIN cve_scores cs ON cs.cve_id = je.value AND cs.cisa_kev = 1
      )`
    : ''

  // Build cursor condition (uses CTE column names — no table prefix).
  // The keyset is: items that come AFTER (rank_score DESC, id ASC) position of cursor.
  // Uses direct float comparison; cursor encodes the exact float from the DB row.
  const cursorClause = cursor
    ? 'AND (rank_score < ? OR (rank_score = ? AND id > ?))'
    : ''

  const cursorValues = cursor ? [cursor.rankScore, cursor.rankScore, cursor.id] : []

  const sql = `
    WITH ranked AS (
      SELECT
        f.id,
        f.scan_id,
        sc.project_id,
        p.name AS project_name,
        f.detector,
        f.severity,
        f.title,
        f.location_path,
        f.dedup_key,
        f.occurrence_count,
        f.first_detected_at,
        f.last_seen_at,
        f.cve_ids,
        f.patch_diff,
        f.exploitability,
        COALESCE(
          (SELECT MAX(cs.epss_score)
           FROM json_each(f.cve_ids) AS je
           JOIN cve_scores cs ON cs.cve_id = je.value),
          0.01
        ) AS epss_score,
        COALESCE(
          (SELECT MAX(cs.cisa_kev)
           FROM json_each(f.cve_ids) AS je
           JOIN cve_scores cs ON cs.cve_id = je.value),
          0
        ) AS cisa_kev,
        CASE
          WHEN f.first_detected_at IS NOT NULL
          THEN MAX(julianday('now') - julianday(f.first_detected_at), 0)
          ELSE 0
        END AS days_open,
        f.exploitability
          * COALESCE(
              (SELECT MAX(cs.epss_score)
               FROM json_each(f.cve_ids) AS je
               JOIN cve_scores cs ON cs.cve_id = je.value),
              0.01
            )
          * (1 + 0.5 * COALESCE(
              (SELECT MAX(cs.cisa_kev)
               FROM json_each(f.cve_ids) AS je
               JOIN cve_scores cs ON cs.cve_id = je.value),
              0
            ))
          * ln(1 + CASE
              WHEN f.first_detected_at IS NOT NULL
              THEN MAX(julianday('now') - julianday(f.first_detected_at), 0)
              ELSE 0
            END)
          AS rank_score
      FROM findings f
      JOIN scans sc ON sc.id = f.scan_id
      JOIN projects p ON p.id = sc.project_id
      WHERE f.canonical_finding_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM finding_dismissals fd
          WHERE fd.dedup_key = f.dedup_key
            AND fd.undone_at IS NULL
        )
        ${severityClause}
        ${projectClause}
        ${patchClause}
        ${kevOnlyClause}
    )
    SELECT *
    FROM ranked
    WHERE 1=1
      ${cursorClause}
    ORDER BY rank_score DESC, id ASC
    LIMIT ?
  `

  const allValues: unknown[] = [
    ...severityValues,
    ...projectValues,
    ...cursorValues,
    limit + 1,
  ]

  const sqlite = db.$client
  const rows = sqlite.prepare(sql).all(...allValues) as Array<{
    id: string
    scan_id: string
    project_id: string
    project_name: string
    detector: string
    severity: string
    title: string
    location_path: string
    dedup_key: string | null
    occurrence_count: number
    first_detected_at: string | null
    last_seen_at: string | null
    cve_ids: string | null
    patch_diff: string | null
    epss_score: number
    cisa_kev: number
    days_open: number
    rank_score: number
    exploitability: number
  }>

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows

  const dtos: QueueRowDTO[] = items.map((row) => ({
    id: row.id,
    scanId: row.scan_id,
    projectId: row.project_id,
    projectName: row.project_name,
    detector: row.detector,
    severity: row.severity,
    title: row.title,
    locationPath: row.location_path,
    dedupKey: row.dedup_key,
    occurrenceCount: row.occurrence_count,
    firstDetectedAt: row.first_detected_at,
    lastSeenAt: row.last_seen_at,
    cveIds: row.cve_ids ? (JSON.parse(row.cve_ids) as string[]) : null,
    patchDiff: row.patch_diff,
    epssScore: row.epss_score,
    cisaKev: row.cisa_kev,
    daysOpen: row.days_open,
    rankScore: row.rank_score,
    exploitability: row.exploitability,
  }))

  let nextCursor: string | null = null
  if (hasMore) {
    const last = dtos[dtos.length - 1]
    nextCursor = encodeCursor(last.id, last.rankScore)
  }

  return { items: dtos, nextCursor }
}

/**
 * Returns aggregate statistics for the remediation queue.
 * Counts only canonical, non-dismissed findings.
 *
 * @param db - Drizzle database instance
 * @returns Queue statistics
 */
export function getQueueStats(db: DB): QueueStats {
  const sqlite = db.$client

  const rows = sqlite.prepare(`
    SELECT f.severity, COUNT(*) as count
    FROM findings f
    WHERE f.canonical_finding_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM finding_dismissals fd
        WHERE fd.dedup_key = f.dedup_key
          AND fd.undone_at IS NULL
      )
    GROUP BY f.severity
  `).all() as Array<{ severity: string; count: number }>

  const bySeverity: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    bySeverity[row.severity] = row.count
    total += row.count
  }

  const kevRow = sqlite.prepare(`
    SELECT COUNT(DISTINCT f.id) as count
    FROM findings f
    JOIN json_each(f.cve_ids) je ON 1=1
    JOIN cve_scores cs ON cs.cve_id = je.value AND cs.cisa_kev = 1
    WHERE f.canonical_finding_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM finding_dismissals fd
        WHERE fd.dedup_key = f.dedup_key AND fd.undone_at IS NULL
      )
  `).get() as { count: number }

  const patchRow = sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM findings f
    WHERE f.canonical_finding_id IS NULL
      AND f.patch_diff IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM finding_dismissals fd
        WHERE fd.dedup_key = f.dedup_key AND fd.undone_at IS NULL
      )
  `).get() as { count: number }

  return {
    total,
    bySeverity,
    byKev: kevRow?.count ?? 0,
    byPatch: patchRow?.count ?? 0,
  }
}
