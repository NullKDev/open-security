import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { cacheGet, cacheSet } from './cache'
import { mapSocketAlert, type SocketAlertMapping } from './socket-alert-mapper'

type DB = BetterSQLite3Database<typeof schema>

const SOCKET_API_BASE = 'https://api.socket.dev/v0'

/** Cache TTL: 7 days */
const CACHE_TTL_SEC = 7 * 24 * 60 * 60

/** Max concurrent requests */
const CONCURRENCY = 5

/** Retry delays in ms for 429 responses */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000]

export interface PackageInput {
  name: string
  version: string
  ecosystem: string
}

export interface SocketFinding {
  tag: string
  severity: SocketAlertMapping['severity']
  packageName: string
  packageVersion: string
  ecosystem: string
  alertType: string
}

interface SocketApiResponse {
  alerts?: { type: string }[]
}

/**
 * Delay helper for backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch Socket.dev data for one package with 429-aware exponential backoff.
 *
 * @param ecosystem - Package ecosystem (npm | pypi | ...)
 * @param name - Package name
 * @param version - Package version
 * @param apiKey - Socket API key
 * @returns Parsed response or null on error
 */
async function fetchSocketPackage(
  ecosystem: string,
  name: string,
  version: string,
  apiKey: string,
): Promise<SocketApiResponse | null> {
  // Socket.dev ecosystem path mapping
  const ecoPath = ecosystem.toLowerCase() === 'pypi' ? 'pypi' : ecosystem.toLowerCase()
  const url = `${SOCKET_API_BASE}/${ecoPath}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`

  let lastError: unknown = null

  for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, { // security-data-fetch
        headers: {
          Authorization: `Basic ${btoa(apiKey + ':')}`,
          Accept: 'application/json',
        },
      })

      if (response.status === 429) {
        // Rate limited — backoff and retry
        const backoffMs = BACKOFF_DELAYS_MS[attempt]
        if (backoffMs !== undefined) {
          await delay(backoffMs)
          continue
        }
        // Exhausted retries
        return null
      }

      if (!response.ok) return null

      return (await response.json()) as SocketApiResponse
    } catch (err) {
      lastError = err
      if (attempt < BACKOFF_DELAYS_MS.length) {
        const backoffMs = BACKOFF_DELAYS_MS[attempt]
        if (backoffMs !== undefined) await delay(backoffMs)
      }
    }
  }

  void lastError
  return null
}

/**
 * Scan a list of packages against Socket.dev and return security findings.
 *
 * - Reads `OBT_SOCKET_API_KEY` env var; returns empty array if not set.
 * - Uses DB-level cache (`enrichment_cache`) with 7-day TTL.
 * - Processes packages in batches of `CONCURRENCY` (5) to avoid hammering the API.
 * - Retries on HTTP 429 with exponential backoff (1s/2s/4s, max 3 retries).
 *
 * @param packages - List of packages to scan
 * @param db - Drizzle database instance (for cache)
 * @returns Array of socket findings (one per alert per package)
 */
export async function scanPackages(
  packages: PackageInput[],
  db: DB,
): Promise<SocketFinding[]> {
  const apiKey = process.env['OBT_SOCKET_API_KEY']
  if (!apiKey) return []

  if (packages.length === 0) return []

  const findings: SocketFinding[] = []

  // Process in batches of CONCURRENCY
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY)

    const batchResults = await Promise.all(
      batch.map(async (pkg) => {
        const cacheKey = `socket:${pkg.ecosystem}:${pkg.name}:${pkg.version}`

        // Check cache first
        const cached = cacheGet<SocketFinding[]>(db, cacheKey)
        if (cached !== null) {
          return cached
        }

        const data = await fetchSocketPackage(
          pkg.ecosystem,
          pkg.name,
          pkg.version,
          apiKey,
        )

        const pkgFindings: SocketFinding[] = []

        if (data?.alerts && data.alerts.length > 0) {
          for (const alert of data.alerts) {
            const mapping = mapSocketAlert(alert.type)
            pkgFindings.push({
              tag: mapping.tag,
              severity: mapping.severity,
              packageName: pkg.name,
              packageVersion: pkg.version,
              ecosystem: pkg.ecosystem,
              alertType: alert.type,
            })
          }
        }

        // Cache result (even empty results) for 7 days
        cacheSet(db, cacheKey, pkgFindings, CACHE_TTL_SEC)

        return pkgFindings
      }),
    )

    for (const result of batchResults) {
      findings.push(...result)
    }
  }

  return findings
}
