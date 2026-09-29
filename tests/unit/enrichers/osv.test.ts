/**
 * tests/unit/enrichers/osv.test.ts
 *
 * TDD RED → GREEN: T-018 + T-019 — OSV enricher v2
 *
 * Covers:
 * - CVE lookup populates cve_scores row
 * - GHSA alias resolved (alias in response maps to canonical CVE)
 * - Cache hit skips network call
 * - OSV 404 triggers NVD fallback path (logs, no actual call needed in test)
 * - No cve_ids → no network calls
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { enrichCve } from '@/lib/enrichers/osv'
import { eq } from 'drizzle-orm'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeOsvQueryResponse(overrides: {
  id?: string
  aliases?: string[]
  summary?: string
  cvssScore?: number
  affected?: object[]
} = {}): object {
  return {
    vulns: [
      {
        id: overrides.id ?? 'CVE-2024-0001',
        aliases: overrides.aliases ?? [],
        summary: overrides.summary ?? 'Test vulnerability',
        severity: [
          {
            type: 'CVSS_V3',
            score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          },
        ],
        affected: overrides.affected ?? [
          {
            package: { ecosystem: 'npm', name: 'lodash' },
            ranges: [
              {
                type: 'SEMVER',
                events: [{ introduced: '0' }, { fixed: '4.17.21' }],
              },
            ],
            versions: ['4.17.20', '4.17.19'],
          },
        ],
      },
    ],
  }
}

describe('enrichCve()', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  describe('successful enrichment', () => {
    it('fetches CVE data and writes a cve_scores row', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvQueryResponse({ id: 'CVE-2024-0001' }),
      })

      await enrichCve('CVE-2024-0001', db)

      const { cveScores } = await import('@/lib/db/schema')
      const scores = db.select().from(cveScores).where(eq(cveScores.cveId, 'CVE-2024-0001')).all()
      expect(scores).toHaveLength(1)
      expect(scores[0]?.source).toBe('osv')
    })

    it('maps CVSS vector string into cve_scores', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvQueryResponse({ id: 'CVE-2024-CVSS' }),
      })

      await enrichCve('CVE-2024-CVSS', db)

      const { cveScores } = await import('@/lib/db/schema')
      const scores = db.select().from(cveScores).where(eq(cveScores.cveId, 'CVE-2024-CVSS')).all()
      expect(scores[0]?.cvssVector).toContain('CVSS:3.1')
    })

    it('resolves GHSA alias — writes row with ghsa_id set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeOsvQueryResponse({
            id: 'CVE-2024-GHSA',
            aliases: ['GHSA-xxxx-yyyy-zzzz'],
          }),
      })

      await enrichCve('CVE-2024-GHSA', db)

      const { cveScores } = await import('@/lib/db/schema')
      const scores = db.select().from(cveScores).where(eq(cveScores.cveId, 'CVE-2024-GHSA')).all()
      expect(scores[0]?.ghsaId).toBe('GHSA-xxxx-yyyy-zzzz')
    })

    it('maps fix_version from first SEMVER range fixed event', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvQueryResponse({ id: 'CVE-2024-FIX' }),
      })

      await enrichCve('CVE-2024-FIX', db)

      const { cveScores } = await import('@/lib/db/schema')
      const scores = db.select().from(cveScores).where(eq(cveScores.cveId, 'CVE-2024-FIX')).all()
      expect(scores[0]?.fixedVersion).toBe('4.17.21')
    })
  })

  describe('caching', () => {
    it('cache hit skips network — fetch not called second time', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvQueryResponse({ id: 'CVE-2024-CACHED' }),
      })

      await enrichCve('CVE-2024-CACHED', db)
      await enrichCve('CVE-2024-CACHED', db)

      // Only one HTTP call — second call served from cache
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('OSV 404 → logs fallback path, does not throw', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      })

      // Should not throw
      await expect(enrichCve('CVE-2024-NOTFOUND', db)).resolves.toBeUndefined()
    })

    it('no cve_ids passed → zero network calls', async () => {
      // Pass an undefined/empty CVE ID — implementation must guard
      await enrichCve('', db)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
