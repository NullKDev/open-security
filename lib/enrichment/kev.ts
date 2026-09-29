/**
 * kev.ts — CISA Known Exploited Vulnerabilities (KEV) catalog service
 *
 * Downloads the CISA KEV JSON once per day, caches it locally in the OBT
 * workspace, and exposes an in-memory lookup for `isKevListed(cveId)`.
 *
 * Design constraints (ADR §4):
 * - Full JSON (~1MB), parse `vulnerabilities[].cveID` to Set
 * - Update existing `cve_scores` rows; do NOT create rows for KEV-only CVEs
 * - File cache: `<cacheDir>/kev.json` (written after successful fetch)
 * - Never throws, never blocks callers
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { getKevListedIds, upsertCveScore } from '@/lib/repos/cve-scores.repo'
import { eq } from 'drizzle-orm'
import { cveScores } from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

const KEV_CATALOG_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const REQUEST_TIMEOUT_MS = 5000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Zod schema for a single KEV vulnerability entry */
const KevVulnerabilitySchema = z.object({
  cveID: z.string(),
  vendorProject: z.string(),
  product: z.string(),
  vulnerabilityName: z.string(),
  dateAdded: z.string(),
  shortDescription: z.string(),
  requiredAction: z.string(),
  dueDate: z.string(),
})

/** Zod schema for the full CISA KEV catalog */
const KevCatalogSchema = z.object({
  title: z.string(),
  catalogVersion: z.string(),
  dateReleased: z.string(),
  count: z.number(),
  vulnerabilities: z.array(KevVulnerabilitySchema),
})

export interface KevService {
  /** Returns true if the CVE is in the CISA KEV catalog. */
  isKevListed(cveId: string): boolean
}

/**
 * Parses a raw KEV catalog response using Zod validation.
 *
 * @param raw - Unknown response body from the KEV API
 * @returns Array of CVE ID strings, or null if the response is invalid
 */
export function parseKevCatalog(raw: unknown): string[] | null {
  const parsed = KevCatalogSchema.safeParse(raw)
  if (!parsed.success) return null

  return parsed.data.vulnerabilities.map((v) => v.cveID)
}

/**
 * Downloads the KEV catalog, updates cve_scores rows with cisa_kev=1,
 * and writes the catalog JSON to the file cache.
 *
 * Only updates CVEs that already exist in `cve_scores`; does NOT insert
 * new rows for KEV-only CVEs that haven't been seen in findings.
 *
 * Never throws — all errors are caught and warned.
 *
 * @param db - Drizzle database instance
 * @param cacheDir - Directory to write `kev.json` (e.g. `.obt/cache`)
 */
export async function refreshKevCatalog(db: DB, cacheDir: string): Promise<void> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const response = await fetch(KEV_CATALOG_URL, { signal: controller.signal }) // security-data-fetch
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[enrichment] KEV catalog fetch returned ${response.status}`)
      return
    }

    const raw = await response.json()
    const cveIds = parseKevCatalog(raw)

    if (!cveIds) {
      console.warn('[enrichment] KEV catalog response failed Zod validation')
      return
    }

    // Update only rows that already exist in cve_scores (don't create new rows)
    const fetchedAt = new Date().toISOString()
    const kevSet = new Set(cveIds)

    // Get existing CVE score rows to find which ones to update
    const existingRows = db.select({ cveId: cveScores.cveId }).from(cveScores).all()

    for (const row of existingRows) {
      const isKev = kevSet.has(row.cveId) ? 1 : 0
      db.update(cveScores)
        .set({ cisaKev: isKev, fetchedAt })
        .where(eq(cveScores.cveId, row.cveId))
        .run()
    }

    // Write file cache
    fs.mkdirSync(cacheDir, { recursive: true })
    const cachePath = path.join(cacheDir, 'kev.json')
    fs.writeFileSync(cachePath, JSON.stringify(raw), 'utf-8')
  } catch (err) {
    console.warn('[enrichment] KEV catalog refresh error:', err)
  }
}

/**
 * Creates a KEV service that provides in-memory lookup of KEV-listed CVEs.
 *
 * On creation, loads existing KEV IDs from the DB into an in-memory Set.
 * After a `refreshKevCatalog` call, callers should recreate the service or
 * call refresh which also updates the in-memory set.
 *
 * @param db - Drizzle database instance
 * @param cacheDir - Directory where `kev.json` is cached (for future use)
 * @returns KevService with `isKevListed` method
 */
export function createKevService(db: DB, _cacheDir: string): KevService {
  // Hydrate from DB on creation
  const kevSet = new Set(getKevListedIds(db))

  return {
    isKevListed(cveId: string): boolean {
      return kevSet.has(cveId)
    },
  }
}
