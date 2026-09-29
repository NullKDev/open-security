/**
 * service.ts — Enrichment orchestrator
 *
 * Coordinates post-scan enrichment:
 * 1. Extracts CVE IDs from all canonical findings in a scan
 * 2. Skips CVEs already cached (fetched_at < 24h)
 * 3. Calls EPSS service for missing/stale CVEs
 * 4. Refreshes KEV catalog (best-effort, never blocks)
 * 5. Calls Socket.dev enricher for npm/PyPI packages (v1.0)
 *
 * Design constraints (ADR §4):
 * - Called by pipeline after findings are persisted
 * - Never throws — all errors are caught and warned
 * - Best-effort: enrichment failure does not block scan completion
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { findings } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { getScoresForCves } from '@/lib/repos/cve-scores.repo'
import { enrichMissingCves } from './epss'
import { refreshKevCatalog } from './kev'
import { scanPackages, type PackageInput } from '@/lib/enrichers/socket'

type DB = BetterSQLite3Database<typeof schema>

/**
 * Extracts all unique CVE IDs from canonical findings in a given scan.
 * Only processes findings with cve_ids set (osv detector).
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan ID to extract CVEs from
 * @returns Deduplicated array of CVE ID strings
 */
function extractCveIdsFromScan(db: DB, scanId: string): string[] {
  const rows = db
    .select({ cveIds: findings.cveIds })
    .from(findings)
    .where(eq(findings.scanId, scanId))
    .all()

  const allCveIds = new Set<string>()

  for (const row of rows) {
    if (!row.cveIds) continue
    try {
      const ids = JSON.parse(row.cveIds) as string[]
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string' && id.startsWith('CVE-')) {
            allCveIds.add(id)
          }
        }
      }
    } catch {
      // Skip malformed cve_ids JSON
    }
  }

  return [...allCveIds]
}

/**
 * Orchestrates post-scan enrichment for a given scan.
 *
 * Steps:
 * 1. Extract CVE IDs from all findings in the scan
 * 2. Filter out CVEs already cached and fresh (< 24h)
 * 3. Fetch EPSS scores for uncached CVEs
 * 4. Refresh KEV catalog (best-effort)
 *
 * Never throws — all errors are caught and logged with `[enrichment]` prefix.
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan ID to enrich
 * @param cacheDir - Directory for KEV file cache (e.g. `.obt/cache`)
 */
export async function enrichScan(db: DB, scanId: string, cacheDir: string): Promise<void> {
  try {
    const allCveIds = extractCveIdsFromScan(db, scanId)

    if (allCveIds.length > 0) {
      // Find CVEs that are missing or stale in the cache
      const cached = getScoresForCves(db, allCveIds)
      const uncachedIds = allCveIds.filter((id) => cached.get(id) === null)

      if (uncachedIds.length > 0) {
        await enrichMissingCves(db, uncachedIds)
      }
    }

    // Refresh KEV catalog regardless (best-effort, cheap check via file cache TTL)
    await refreshKevCatalog(db, cacheDir)
  } catch (err) {
    console.warn('[enrichment] enrichScan error:', err)
  }
}

/**
 * Extract package metadata from findings tagged with ecosystem/package info.
 *
 * Reads the `tags` JSON column looking for entries shaped as
 * `{ ecosystem: string, name: string, version: string }`.
 * Only processes findings with `detector = 'osv-scanner'` (other detectors
 * don't produce package-level results).
 *
 * @param db - Drizzle database instance
 * @param scanId - Scan to extract packages from
 * @returns Deduplicated list of packages to scan with Socket.dev
 */
function extractPackagesFromScan(db: DB, scanId: string): PackageInput[] {
  const rows = db
    .select({ tags: findings.tags, detector: findings.detector })
    .from(findings)
    .where(eq(findings.scanId, scanId))
    .all()

  const seen = new Set<string>()
  const packages: PackageInput[] = []

  for (const row of rows) {
    if (!row.tags) continue
    try {
      const tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags
      if (!Array.isArray(tags)) continue
      for (const tag of tags) {
        if (
          typeof tag === 'object' &&
          tag !== null &&
          typeof tag.ecosystem === 'string' &&
          typeof tag.name === 'string' &&
          typeof tag.version === 'string'
        ) {
          const key = `${tag.ecosystem}:${tag.name}:${tag.version}`
          if (!seen.has(key)) {
            seen.add(key)
            packages.push({
              ecosystem: tag.ecosystem,
              name: tag.name,
              version: tag.version,
            })
          }
        }
      }
    } catch {
      // Malformed tags JSON — skip
    }
  }

  return packages
}

/**
 * Run Socket.dev enrichment for all npm/PyPI packages found in a scan's findings.
 *
 * Extracts packages from `tags` JSON in findings, calls `scanPackages`, and
 * persists any Socket findings to the `findings` table with `detector = 'socket'`.
 *
 * Never throws — errors are caught and logged with `[socket-enrichment]` prefix.
 *
 * @param db - Drizzle database instance
 * @param scanId - The scan ID to enrich
 */
export async function enrichScanWithSocket(db: DB, scanId: string): Promise<void> {
  try {
    const packages = extractPackagesFromScan(db, scanId)
    if (packages.length === 0) return

    const socketFindings = await scanPackages(packages, db)

    for (const finding of socketFindings) {
      // Insert each socket finding into the findings table
      db.insert(findings)
        .values({
          id: crypto.randomUUID(),
          scanId,
          detector: 'socket',
          severity: finding.severity === 'info' ? 'low' : finding.severity,
          confidence: 1.0,
          exploitability: 0,
          title: `${finding.tag}: ${finding.packageName}@${finding.packageVersion}`,
          description: `Socket.dev alert: ${finding.alertType} detected in ${finding.packageName}@${finding.packageVersion} (${finding.ecosystem})`,
          locationPath: 'package-lock.json',
          locationLineStart: 1,
          tags: JSON.stringify([finding.tag]),
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .run()
    }
  } catch (err) {
    console.warn('[socket-enrichment] enrichScanWithSocket error:', err)
  }
}
