/**
 * tests/unit/enrichment/kev.test.ts
 *
 * TDD: T-C07 — KEV service
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the CISA KEV catalog fetcher:
 * - parseKevCatalog: pure Zod-validated response parsing
 * - isKevListed: in-memory lookup
 * - refreshKevCatalog: download, parse, update DB + file cache
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { upsertCveScore } from '@/lib/repos/cve-scores.repo'
import { parseKevCatalog, refreshKevCatalog, createKevService } from '@/lib/enrichment/kev'

const MOCK_KEV_RESPONSE = {
  title: 'CISA Known Exploited Vulnerabilities Catalog',
  catalogVersion: '2025.01.01',
  dateReleased: '2025-01-01T00:00:00Z',
  count: 2,
  vulnerabilities: [
    {
      cveID: 'CVE-2024-KEV-1',
      vendorProject: 'TestVendor',
      product: 'TestProduct',
      vulnerabilityName: 'Test Vuln 1',
      dateAdded: '2024-01-01',
      shortDescription: 'Test',
      requiredAction: 'Patch',
      dueDate: '2024-02-01',
    },
    {
      cveID: 'CVE-2024-KEV-2',
      vendorProject: 'AnotherVendor',
      product: 'AnotherProduct',
      vulnerabilityName: 'Test Vuln 2',
      dateAdded: '2024-02-01',
      shortDescription: 'Another test',
      requiredAction: 'Patch',
      dueDate: '2024-03-01',
    },
  ],
}

describe('parseKevCatalog', () => {
  it('extracts CVE IDs from a valid KEV catalog response', () => {
    const cveIds = parseKevCatalog(MOCK_KEV_RESPONSE)
    expect(cveIds).toContain('CVE-2024-KEV-1')
    expect(cveIds).toContain('CVE-2024-KEV-2')
    expect(cveIds).toHaveLength(2)
  })

  it('returns empty array for empty vulnerabilities list', () => {
    const cveIds = parseKevCatalog({ ...MOCK_KEV_RESPONSE, vulnerabilities: [], count: 0 })
    expect(cveIds).toHaveLength(0)
  })

  it('returns null for invalid response shape', () => {
    const cveIds = parseKevCatalog({ unexpected: true })
    expect(cveIds).toBeNull()
  })

  it('handles large catalogs correctly', () => {
    const largeVulns = Array.from({ length: 100 }, (_, i) => ({
      cveID: `CVE-2024-${i + 1000}`,
      vendorProject: 'V',
      product: 'P',
      vulnerabilityName: 'N',
      dateAdded: '2024-01-01',
      shortDescription: 'D',
      requiredAction: 'R',
      dueDate: '2024-02-01',
    }))
    const cveIds = parseKevCatalog({ ...MOCK_KEV_RESPONSE, vulnerabilities: largeVulns, count: 100 })
    expect(cveIds).toHaveLength(100)
    expect(cveIds![0]).toBe('CVE-2024-1000')
  })
})

describe('createKevService', () => {
  let db: ReturnType<typeof createTestDb>
  let tmpDir: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kev-test-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('isKevListed returns false for unknown CVE before any fetch', () => {
    const svc = createKevService(db, tmpDir)
    expect(svc.isKevListed('CVE-2024-UNKNOWN')).toBe(false)
  })

  it('isKevListed returns true for a CVE in the DB with cisa_kev=1', () => {
    upsertCveScore(db, {
      cveId: 'CVE-2024-KEV',
      epssScore: null,
      epssPercentile: null,
      cisaKev: 1,
      fetchedAt: new Date().toISOString(),
    })
    const svc = createKevService(db, tmpDir)
    // After initialization, the service should check DB
    expect(svc.isKevListed('CVE-2024-KEV')).toBe(true)
  })

  it('refreshKevCatalog updates DB cisa_kev flags and writes file cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_KEV_RESPONSE),
    }))

    // Pre-insert the CVEs in cve_scores so they exist to update
    upsertCveScore(db, { cveId: 'CVE-2024-KEV-1', epssScore: 0.5, epssPercentile: 0.8, cisaKev: 0, fetchedAt: new Date().toISOString() })
    upsertCveScore(db, { cveId: 'CVE-2024-KEV-2', epssScore: 0.3, epssPercentile: 0.6, cisaKev: 0, fetchedAt: new Date().toISOString() })

    await refreshKevCatalog(db, tmpDir)

    // DB rows should be updated to cisa_kev=1
    const { getKevListedIds } = await import('@/lib/repos/cve-scores.repo')
    const kevIds = getKevListedIds(db)
    expect(kevIds).toContain('CVE-2024-KEV-1')
    expect(kevIds).toContain('CVE-2024-KEV-2')

    // File cache should exist
    const cacheFile = path.join(tmpDir, 'kev.json')
    expect(fs.existsSync(cacheFile)).toBe(true)
  })

  it('refreshKevCatalog does not throw when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    await expect(refreshKevCatalog(db, tmpDir)).resolves.not.toThrow()
  })
})
