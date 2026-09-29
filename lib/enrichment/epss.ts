/**
 * epss.ts — EPSS score fetcher from FIRST.org API
 *
 * EPSS (Exploit Prediction Scoring System) provides probability scores
 * for CVE exploitation. This module fetches scores in batches, applies
 * rate limiting, and writes results to the cve_scores cache table.
 *
 * API: https://api.first.org/data/v1/epss?cve=CVE-xxx,CVE-yyy
 * Rate limit: 10 req/sec (enforced by token-bucket rate limiter)
 * Timeout: 5 seconds per request
 * Batch size: up to 30 CVEs per request
 */
import { z } from 'zod'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { upsertCveScore } from '@/lib/repos/cve-scores.repo'
import { createRateLimiter } from './rate-limiter'

type DB = BetterSQLite3Database<typeof schema>

const EPSS_API_BASE = 'https://api.first.org/data/v1/epss'
const BATCH_SIZE = 30
const REQUEST_TIMEOUT_MS = 5000

/** Shared rate limiter: 10 req/sec (FIRST.org policy) */
const rateLimiter = createRateLimiter(10)

/** Zod schema for a single EPSS data entry */
const EpssEntrySchema = z.object({
  cve: z.string(),
  epss: z.string(),
  percentile: z.string(),
  date: z.string(),
})

/** Zod schema for the full EPSS API response */
const EpssResponseSchema = z.object({
  status: z.string(),
  status_code: z.number(),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  data: z.array(EpssEntrySchema),
})

export interface EpssEntry {
  cveId: string
  epssScore: number
  epssPercentile: number
}

/**
 * Splits an array into chunks of a given size.
 *
 * @param items - Array to split
 * @param batchSize - Maximum items per batch
 * @returns Array of batches (arrays)
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize))
  }
  return batches
}

/**
 * Parses a raw EPSS API response using Zod validation.
 *
 * @param raw - Unknown response body from the EPSS API
 * @returns Array of EpssEntry objects, or null if the response is invalid
 */
export function parseEpssResponse(raw: unknown): EpssEntry[] | null {
  const parsed = EpssResponseSchema.safeParse(raw)
  if (!parsed.success) return null

  return parsed.data.data.map((entry) => ({
    cveId: entry.cve,
    epssScore: parseFloat(entry.epss),
    epssPercentile: parseFloat(entry.percentile),
  }))
}

/**
 * Fetches EPSS scores for the given CVE IDs and writes them to the DB cache.
 *
 * - Batches CVEs at most 30 per request
 * - Applies 10 req/sec rate limiting
 * - Uses 5-second AbortController timeout
 * - Never throws: network errors are caught and logged
 *
 * @param db - Drizzle database instance
 * @param cveIds - CVE IDs to fetch EPSS scores for
 */
export async function enrichMissingCves(db: DB, cveIds: string[]): Promise<void> {
  if (cveIds.length === 0) return

  const batches = splitIntoBatches(cveIds, BATCH_SIZE)

  for (const batch of batches) {
    try {
      await rateLimiter.acquire()

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const url = `${EPSS_API_BASE}?cve=${batch.join(',')}`
      const response = await fetch(url, { signal: controller.signal }) // security-data-fetch
      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`[enrichment] EPSS API returned ${response.status} for batch`)
        continue
      }

      const raw = await response.json()
      const entries = parseEpssResponse(raw)

      if (!entries) {
        console.warn('[enrichment] EPSS API response failed Zod validation')
        continue
      }

      const fetchedAt = new Date().toISOString()
      for (const entry of entries) {
        upsertCveScore(db, {
          cveId: entry.cveId,
          epssScore: entry.epssScore,
          epssPercentile: entry.epssPercentile,
          cisaKev: 0, // KEV status is managed by the KEV service, not EPSS
          fetchedAt,
        })
      }
    } catch (err) {
      console.warn('[enrichment] EPSS fetch error:', err)
    }
  }
}
