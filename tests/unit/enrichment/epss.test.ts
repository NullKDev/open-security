/**
 * tests/unit/enrichment/epss.test.ts
 *
 * TDD: T-C05 — EPSS service
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the pure, testable parts of the EPSS service:
 * - splitIntoBatches: batch splitting logic
 * - parseEpssResponse: Zod-validated response parsing
 * - enrichMissingCves: integration with DB using a mocked fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { getScoresForCves } from '@/lib/repos/cve-scores.repo'
import { splitIntoBatches, parseEpssResponse, enrichMissingCves } from '@/lib/enrichment/epss'

describe('splitIntoBatches', () => {
  it('returns single batch when CVE count is within limit', () => {
    const cves = ['CVE-2024-1', 'CVE-2024-2', 'CVE-2024-3']
    const batches = splitIntoBatches(cves, 30)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual(cves)
  })

  it('splits into multiple batches when over limit', () => {
    const cves = Array.from({ length: 65 }, (_, i) => `CVE-2024-${i + 1}`)
    const batches = splitIntoBatches(cves, 30)
    expect(batches).toHaveLength(3) // 30 + 30 + 5
    expect(batches[0]).toHaveLength(30)
    expect(batches[1]).toHaveLength(30)
    expect(batches[2]).toHaveLength(5)
  })

  it('returns empty array for empty input', () => {
    const batches = splitIntoBatches([], 30)
    expect(batches).toHaveLength(0)
  })

  it('each item appears in exactly one batch (no duplication, no loss)', () => {
    const cves = Array.from({ length: 75 }, (_, i) => `CVE-2024-${i + 1}`)
    const batches = splitIntoBatches(cves, 30)
    const flat = batches.flat()
    expect(flat).toHaveLength(75)
    expect(new Set(flat).size).toBe(75)
  })
})

describe('parseEpssResponse', () => {
  it('parses a valid EPSS API response', () => {
    const raw = {
      status: 'OK',
      status_code: 200,
      total: 1,
      offset: 0,
      limit: 100,
      data: [
        { cve: 'CVE-2024-1234', epss: '0.72312', percentile: '0.95001', date: '2025-01-01' },
      ],
    }

    const result = parseEpssResponse(raw)
    expect(result).toHaveLength(1)
    expect(result[0].cveId).toBe('CVE-2024-1234')
    expect(result[0].epssScore).toBeCloseTo(0.72312)
    expect(result[0].epssPercentile).toBeCloseTo(0.95001)
  })

  it('returns empty array for empty data array', () => {
    const raw = { status: 'OK', status_code: 200, total: 0, offset: 0, limit: 100, data: [] }
    const result = parseEpssResponse(raw)
    expect(result).toHaveLength(0)
  })

  it('returns null for invalid response shape', () => {
    const result = parseEpssResponse({ unexpected: true })
    expect(result).toBeNull()
  })

  it('handles multiple entries in data array', () => {
    const raw = {
      status: 'OK',
      status_code: 200,
      total: 2,
      offset: 0,
      limit: 100,
      data: [
        { cve: 'CVE-2024-1', epss: '0.1', percentile: '0.5', date: '2025-01-01' },
        { cve: 'CVE-2024-2', epss: '0.9', percentile: '0.99', date: '2025-01-01' },
      ],
    }
    const result = parseEpssResponse(raw)
    expect(result).toHaveLength(2)
    expect(result![0].cveId).toBe('CVE-2024-1')
    expect(result![1].cveId).toBe('CVE-2024-2')
  })
})

describe('enrichMissingCves', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches EPSS scores and writes them to the DB for new CVEs', async () => {
    const mockResponse = {
      status: 'OK',
      status_code: 200,
      total: 1,
      offset: 0,
      limit: 100,
      data: [
        { cve: 'CVE-2024-9999', epss: '0.55', percentile: '0.88', date: '2025-01-01' },
      ],
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }))

    await enrichMissingCves(db, ['CVE-2024-9999'])

    const scores = getScoresForCves(db, ['CVE-2024-9999'])
    const score = scores.get('CVE-2024-9999')
    expect(score).not.toBeNull()
    expect(score?.epssScore).toBeCloseTo(0.55)
    expect(score?.epssPercentile).toBeCloseTo(0.88)
  })

  it('does not throw when fetch fails — graceful degradation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    await expect(enrichMissingCves(db, ['CVE-2024-9999'])).resolves.not.toThrow()
  })

  it('does not fetch when CVE list is empty', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await enrichMissingCves(db, [])

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
