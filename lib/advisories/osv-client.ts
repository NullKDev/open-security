/**
 * lib/advisories/osv-client.ts
 *
 * Fetches OSV (Open Source Vulnerabilities) advisories by CVE/GHSA ID.
 * Applies a 10-second timeout, one automatic retry, and an in-memory cache.
 */

/** Parsed metadata from an OSV advisory response. */
export interface AdvisoryMeta {
  /** The OSV/CVE/GHSA identifier. */
  id: string
  /** One-line summary of the vulnerability. */
  summary?: string
  /** Full markdown description. */
  details?: string
  /** Alternate identifiers (e.g. CVE aliases for a GHSA entry). */
  aliases?: string[]
  /** Affected package entries as returned by the OSV API. */
  affected?: unknown[]
  /** External reference links. */
  references?: unknown[]
  /** CWE identifiers associated with this advisory. */
  cwes?: string[]
  /** Primary package name (extracted from first affected entry). */
  packageName?: string
  /** Package ecosystem (e.g. npm, PyPI, Go). */
  packageEcosystem?: string
  /** URL to a public proof-of-concept exploit, if known. */
  pocUrl?: string | null
}

const OSV_BASE_URL = 'https://api.osv.dev/v1/vulns'
const REQUEST_TIMEOUT_MS = 10_000

/** Module-level in-memory cache: id → AdvisoryMeta (null results are NOT cached). */
const cache = new Map<string, AdvisoryMeta>()

/**
 * Clears the in-memory advisory cache.
 * Exported for use in tests to ensure isolation between test cases.
 */
export function clearAdvisoryCache(): void {
  cache.clear()
}

/**
 * Extracts CWE IDs from the OSV `database_specific` field and affected entries.
 */
function extractCwes(raw: Record<string, unknown>): string[] {
  const cwes: string[] = []

  // Common location: database_specific.cwes
  const dbSpecific = raw['database_specific'] as Record<string, unknown> | undefined
  if (dbSpecific) {
    const rawCwes = dbSpecific['cwe_ids'] ?? dbSpecific['cwes']
    if (Array.isArray(rawCwes)) {
      for (const cwe of rawCwes) {
        if (typeof cwe === 'string') cwes.push(cwe)
      }
    }
  }

  return cwes
}

/**
 * Attempts to extract the PoC URL from OSV references.
 */
function extractPocUrl(references: unknown[]): string | null {
  if (!Array.isArray(references)) return null
  for (const ref of references) {
    if (
      typeof ref === 'object' &&
      ref !== null &&
      (ref as Record<string, unknown>)['type'] === 'EVIDENCE'
    ) {
      const url = (ref as Record<string, unknown>)['url']
      if (typeof url === 'string') return url
    }
  }
  return null
}

/**
 * Parses a raw OSV API response into an `AdvisoryMeta` object.
 */
function parseOsvResponse(raw: Record<string, unknown>): AdvisoryMeta {
  const id = typeof raw['id'] === 'string' ? raw['id'] : ''
  const summary = typeof raw['summary'] === 'string' ? raw['summary'] : undefined
  const details = typeof raw['details'] === 'string' ? raw['details'] : undefined
  const aliases = Array.isArray(raw['aliases'])
    ? (raw['aliases'] as unknown[]).filter((a): a is string => typeof a === 'string')
    : []
  const affected = Array.isArray(raw['affected']) ? raw['affected'] : []
  const references = Array.isArray(raw['references']) ? raw['references'] : []
  const cwes = extractCwes(raw)
  const pocUrl = extractPocUrl(references)

  // Extract package info from first affected entry
  let packageName: string | undefined
  let packageEcosystem: string | undefined
  if (affected.length > 0) {
    const firstAffected = affected[0] as Record<string, unknown>
    const pkg = firstAffected['package'] as Record<string, unknown> | undefined
    if (pkg) {
      packageName = typeof pkg['name'] === 'string' ? pkg['name'] : undefined
      packageEcosystem = typeof pkg['ecosystem'] === 'string' ? pkg['ecosystem'] : undefined
    }
  }

  return { id, summary, details, aliases, affected, references, cwes, packageName, packageEcosystem, pocUrl }
}

/**
 * Fetches an OSV advisory by its CVE or GHSA identifier.
 *
 * - Uses a 10-second AbortSignal timeout.
 * - Retries once on network failure.
 * - Caches successful results in memory (null results are not cached).
 *
 * @param id - The CVE or GHSA identifier (e.g. `CVE-2024-0001`).
 * @returns The parsed `AdvisoryMeta`, or `null` if not found or on error.
 */
export async function fetchAdvisory(id: string): Promise<AdvisoryMeta | null> {
  const cached = cache.get(id)
  if (cached !== undefined) return cached

  const url = `${OSV_BASE_URL}/${encodeURIComponent(id)}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal }) // security-data-fetch
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      // Any non-success: return null (not cached, caller may retry)
      return null
    }

    const raw = (await response.json()) as Record<string, unknown>
    const meta = parseOsvResponse(raw)
    cache.set(id, meta)
    return meta
  } catch {
    // Network error, timeout, or abort — return null (not cached)
    return null
  }
}
