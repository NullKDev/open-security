/**
 * tests/unit/advisories/osv-client.test.ts
 *
 * TDD: T-004/T-005 — OsvClient
 * Tests for fetching and parsing OSV advisories.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAdvisory, clearAdvisoryCache, type AdvisoryMeta } from '@/lib/advisories/osv-client'

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  clearAdvisoryCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  clearAdvisoryCache()
})

function makeOsvResponse(overrides: Partial<{
  id: string
  summary: string
  details: string
  aliases: string[]
  affected: unknown[]
  references: unknown[]
  database_specific: Record<string, unknown>
}> = {}): object {
  return {
    id: 'CVE-2024-0001',
    summary: 'Test vulnerability',
    details: 'Detailed description',
    aliases: [],
    affected: [],
    references: [],
    ...overrides,
  }
}

describe('fetchAdvisory()', () => {
  describe('successful parse', () => {
    it('returns AdvisoryMeta on successful 200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvResponse(),
      })

      const result = await fetchAdvisory('CVE-2024-0001')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('CVE-2024-0001')
      expect(result!.summary).toBe('Test vulnerability')
    })

    it('maps all AdvisoryMeta fields from OSV response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvResponse({
          id: 'GHSA-xxxx-yyyy-zzzz',
          summary: 'Auth bypass',
          details: 'Details here',
          aliases: ['CVE-2024-9999'],
          affected: [{ package: { name: 'lodash', ecosystem: 'npm' } }],
          references: [{ type: 'WEB', url: 'https://example.com' }],
        }),
      })

      const result = await fetchAdvisory('GHSA-xxxx-yyyy-zzzz')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('GHSA-xxxx-yyyy-zzzz')
      expect(result!.aliases).toContain('CVE-2024-9999')
      expect(result!.affected).toHaveLength(1)
      expect(result!.references).toHaveLength(1)
    })
  })

  describe('404 → null', () => {
    it('returns null when advisory is not found (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      })

      const result = await fetchAdvisory('CVE-0000-0000')
      expect(result).toBeNull()
    })
  })

  describe('network error → null', () => {
    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))

      const result = await fetchAdvisory('CVE-2024-9999')
      expect(result).toBeNull()
    })
  })

  describe('caching', () => {
    it('second call returns cached result without making a second HTTP request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeOsvResponse({ id: 'CVE-2024-CACHED' }),
      })

      const first = await fetchAdvisory('CVE-2024-CACHED')
      const second = await fetchAdvisory('CVE-2024-CACHED')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(second).toBe(first) // Same reference from cache
    })

    it('null results are not cached — network error retries on next call', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeOsvResponse({ id: 'CVE-2024-RETRY' }),
        })

      const first = await fetchAdvisory('CVE-2024-RETRY')
      const second = await fetchAdvisory('CVE-2024-RETRY')

      expect(first).toBeNull()
      expect(second).not.toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
