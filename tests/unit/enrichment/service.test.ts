/**
 * tests/unit/enrichment/service.test.ts
 *
 * TDD: T-C09 — enrichment service orchestrator
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests enrichScan: extracts CVE IDs from findings for a scan,
 * calls EPSS enrichment for missing CVEs, and refreshes KEV catalog.
 * The service must never throw (graceful degradation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { upsertCveScore } from '@/lib/repos/cve-scores.repo'
import { enrichScan } from '@/lib/enrichment/service'

/** Helper to insert a minimal scan + finding into the test DB */
function seedData(db: ReturnType<typeof createTestDb>) {
  // Insert project
  db.$client
    .prepare(
      `INSERT INTO projects (id, name, source_kind, source_ref, created_at)
       VALUES ('proj-1', 'Test Project', 'local', '/tmp', '2025-01-01T00:00:00Z')`,
    )
    .run()

  // Insert scan
  db.$client
    .prepare(
      `INSERT INTO scans (id, project_id, status)
       VALUES ('scan-1', 'proj-1', 'done')`,
    )
    .run()

  // Insert finding with CVE IDs (osv detector)
  db.$client
    .prepare(
      `INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
         title, description, location_path, location_line_start, created_at, cve_ids)
       VALUES ('find-1', 'scan-1', 'osv', 'HIGH', 0.9, 0.8,
         'CVE-2024-9001 in lodash', 'A critical vulnerability', '/path/to/file.js', 1,
         '2025-01-01T00:00:00Z', '["CVE-2024-9001"]')`,
    )
    .run()
}

describe('enrichScan', () => {
  let db: ReturnType<typeof createTestDb>
  let tmpDir: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-test-'))
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls EPSS enrichment for CVE IDs found in scan findings', async () => {
    seedData(db)

    const mockEpssResponse = {
      status: 'OK',
      status_code: 200,
      total: 1,
      offset: 0,
      limit: 100,
      data: [
        { cve: 'CVE-2024-9001', epss: '0.75', percentile: '0.91', date: '2025-01-01' },
      ],
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockEpssResponse),
    }))

    await enrichScan(db, 'scan-1', tmpDir)

    // CVE score should be written to DB
    const { getScoresForCves } = await import('@/lib/repos/cve-scores.repo')
    const scores = getScoresForCves(db, ['CVE-2024-9001'])
    const score = scores.get('CVE-2024-9001')
    expect(score).not.toBeNull()
    expect(score?.epssScore).toBeCloseTo(0.75)
  })

  it('skips enrichment when scan has no findings with CVE IDs', async () => {
    // Insert scan + finding without cve_ids
    db.$client.prepare(`INSERT INTO projects (id, name, source_kind, source_ref, created_at)
       VALUES ('proj-2', 'P', 'local', '/tmp', '2025-01-01T00:00:00Z')`).run()
    db.$client.prepare(`INSERT INTO scans (id, project_id, status)
       VALUES ('scan-2', 'proj-2', 'done')`).run()
    db.$client.prepare(`INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
         title, description, location_path, location_line_start, created_at)
       VALUES ('find-2', 'scan-2', 'semgrep', 'LOW', 0.5, 0.3,
         'Some issue', '', '/file.ts', 1, '2025-01-01T00:00:00Z')`).run()

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vulnerabilities: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await enrichScan(db, 'scan-2', tmpDir)

    // fetch should not have been called for EPSS (no CVEs)
    // It may be called for KEV though — so we check the EPSS-specific call pattern
    // The EPSS URL contains 'first.org'
    const epssCall = fetchSpy.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('first.org'),
    )
    expect(epssCall).toBeUndefined()
  })

  it('does not throw when EPSS fetch fails', async () => {
    seedData(db)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    await expect(enrichScan(db, 'scan-1', tmpDir)).resolves.not.toThrow()
  })

  it('skips already-cached CVEs (fetched_at within 24h)', async () => {
    seedData(db)

    // Pre-cache the CVE as fresh
    upsertCveScore(db, {
      cveId: 'CVE-2024-9001',
      epssScore: 0.5,
      epssPercentile: 0.8,
      cisaKev: 0,
      fetchedAt: new Date().toISOString(),
    })

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'OK', status_code: 200, total: 0, offset: 0, limit: 100, data: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    await enrichScan(db, 'scan-1', tmpDir)

    // EPSS should NOT be called for this CVE since it's already fresh
    const epssCall = fetchSpy.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('first.org'),
    )
    expect(epssCall).toBeUndefined()
  })
})
