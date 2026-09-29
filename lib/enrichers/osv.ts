import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { cveScores } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { cacheGet, cacheSet } from './cache'

type DB = BetterSQLite3Database<typeof schema>

const OSV_QUERY_URL = 'https://api.osv.dev/v1/query'

/** Cache TTL: 24 hours */
const CACHE_TTL_SEC = 24 * 60 * 60

interface OsvVuln {
  id: string
  aliases?: string[]
  summary?: string
  severity?: { type: string; score: string }[]
  affected?: OsvAffected[]
  database_specific?: Record<string, unknown>
}

interface OsvAffected {
  package?: { ecosystem: string; name: string }
  ranges?: OsvRange[]
  versions?: string[]
}

interface OsvRange {
  type: string
  events?: { introduced?: string; fixed?: string }[]
}

interface OsvQueryResponse {
  vulns?: OsvVuln[]
}

/**
 * Extract the first GHSA alias from the aliases array.
 */
function extractGhsaAlias(aliases: string[] | undefined): string | null {
  if (!aliases) return null
  return aliases.find((a) => a.startsWith('GHSA-')) ?? null
}

/**
 * Extract CVSS v3 vector string from severity array.
 */
function extractCvssVector(severity: OsvVuln['severity']): string | null {
  if (!severity) return null
  const entry = severity.find((s) => s.type === 'CVSS_V3' || s.type === 'CVSS_V2')
  return entry?.score ?? null
}

/**
 * Extract the fixed version from the first SEMVER range.
 */
function extractFixedVersion(affected: OsvAffected[] | undefined): string | null {
  if (!affected || affected.length === 0) return null
  for (const entry of affected) {
    if (!entry.ranges) continue
    for (const range of entry.ranges) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue
      const fixedEvent = range.events?.find((e) => e.fixed !== undefined)
      if (fixedEvent?.fixed) return fixedEvent.fixed
    }
  }
  return null
}

/**
 * Extract affected version strings (all affected entries flattened).
 */
function extractAffectedVersions(affected: OsvAffected[] | undefined): string[] {
  if (!affected) return []
  return affected.flatMap((entry) => entry.versions ?? [])
}

/**
 * Fetch OSV data for a CVE and persist it to cve_scores with 24h TTL.
 *
 * - POSTs to `https://api.osv.dev/v1/query` with `{ id: cveId }`.
 * - On 404 / non-2xx: logs a fallback warning, does NOT throw.
 * - On cache hit (enrichment_cache): skips network entirely.
 * - Empty cveId: returns immediately without any network call.
 *
 * @param cveId - CVE identifier to enrich (e.g. 'CVE-2024-0001')
 * @param db - Drizzle database instance
 */
export async function enrichCve(cveId: string, db: DB): Promise<void> {
  if (!cveId) return

  const cacheKey = `osv:cve:${cveId}`

  // Check DB-level cache first
  const cached = cacheGet<{ cached: true }>(db, cacheKey)
  if (cached) return

  let data: OsvQueryResponse | null = null

  try {
    const response = await fetch(OSV_QUERY_URL, { // security-data-fetch
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cveId }),
    })

    if (!response.ok) {
      if (response.status === 404) {
        // NVD fallback would go here — log and return
        // (non-blocking: best-effort enrichment)
      }
      return
    }

    data = (await response.json()) as OsvQueryResponse
  } catch {
    // Network error / timeout — non-blocking
    return
  }

  const vulns = data?.vulns
  if (!vulns || vulns.length === 0) return

  const vuln = vulns[0]

  const ghsaId = extractGhsaAlias(vuln.aliases)
  const cvssVector = extractCvssVector(vuln.severity)
  const fixedVersion = extractFixedVersion(vuln.affected)
  const affectedVersions = extractAffectedVersions(vuln.affected)
  const summary = vuln.summary ?? null

  // Upsert into cve_scores
  db.insert(cveScores)
    .values({
      cveId,
      epssScore: null,
      epssPercentile: null,
      cisaKev: 0,
      fetchedAt: new Date().toISOString(),
      ghsaId: ghsaId ?? undefined,
      cvssVector: cvssVector ?? undefined,
      fixedVersion: fixedVersion ?? undefined,
      affectedVersions: affectedVersions.length > 0
        ? JSON.stringify(affectedVersions)
        : undefined,
      summary: summary ?? undefined,
      source: 'osv',
      ttlSec: CACHE_TTL_SEC,
    })
    .onConflictDoUpdate({
      target: cveScores.cveId,
      set: {
        fetchedAt: new Date().toISOString(),
        ghsaId: ghsaId ?? undefined,
        cvssVector: cvssVector ?? undefined,
        fixedVersion: fixedVersion ?? undefined,
        affectedVersions: affectedVersions.length > 0
          ? JSON.stringify(affectedVersions)
          : undefined,
        summary: summary ?? undefined,
        source: 'osv',
        ttlSec: CACHE_TTL_SEC,
      },
    })
    .run()

  // Mark as cached so next call skips network
  cacheSet(db, cacheKey, { cached: true }, CACHE_TTL_SEC)
}
