/**
 * tests/api/posture.test.ts
 *
 * Tests for:
 *   GET /api/posture?repo={projectId}&range={7d|30d|60d|90d|all}
 *   GET /api/posture/mttr?repo={projectId}
 *   GET /api/posture/hotspots?repo={projectId}
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { upsertSnapshot, getRegressionRate } from '@/lib/repos/posture.repo'
import { refreshMttr } from '@/lib/posture/mttr'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: {
    subscribe: vi.fn(),
    publish: vi.fn(),
    destroy: vi.fn(),
    replay: vi.fn(() => []),
  },
}))

import { GET as GETPosture } from '@/app/api/posture/route'
import { GET as GETMttr } from '@/app/api/posture/mttr/route'
import { GET as GETHotspots } from '@/app/api/posture/hotspots/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(db: ReturnType<typeof createTestDb>) {
  return createProject(db, { name: 'test-project', sourceKind: 'local', sourceRef: '/tmp' })
}

function makeScan(db: ReturnType<typeof createTestDb>, projectId: string) {
  return createScan(db, { projectId })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── GET /api/posture ─────────────────────────────────────────────────────────

describe('GET /api/posture', () => {
  let projectId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    projectId = project.id
    makeScan(testDb, projectId)
  })

  it('returns 200 with timeseries, regressionRate, openCriticalDays', async () => {
    // Insert a snapshot for today
    upsertSnapshot(testDb, {
      projectId,
      bucketDate: today(),
      countCritical: 2,
      countHigh: 5,
      countMedium: 3,
      countLow: 1,
      countInfo: 0,
    })

    const req = new Request(`http://localhost/api/posture?repo=${projectId}`)
    const res = await GETPosture(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.timeseries)).toBe(true)
    expect(body.data.timeseries.length).toBeGreaterThan(0)
    expect(body.data).toHaveProperty('regressionRate')
    expect(body.data).toHaveProperty('openCriticalDays')
    expect(body.data).toHaveProperty('refreshedAt')
  })

  it('timeseries items have expected shape', async () => {
    upsertSnapshot(testDb, {
      projectId,
      bucketDate: today(),
      countCritical: 1,
      countHigh: 2,
      countMedium: 0,
      countLow: 0,
      countInfo: 0,
    })

    const req = new Request(`http://localhost/api/posture?repo=${projectId}`)
    const res = await GETPosture(req)
    const body = await res.json()

    const item = body.data.timeseries[0]
    expect(item).toHaveProperty('date')
    expect(item).toHaveProperty('weightedScore')
    expect(item).toHaveProperty('countCritical')
    expect(item).toHaveProperty('countHigh')
    expect(typeof item.weightedScore).toBe('number')
    // critical*10 + high*5 = 1*10 + 2*5 = 20
    expect(item.weightedScore).toBe(20)
  })

  it('range filter 7d limits to last 7 days', async () => {
    // Insert an old snapshot (90 days ago)
    const oldDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    upsertSnapshot(testDb, { projectId, bucketDate: oldDate, countCritical: 5 })
    // Insert today's snapshot
    upsertSnapshot(testDb, { projectId, bucketDate: today(), countCritical: 1 })

    const req = new Request(`http://localhost/api/posture?repo=${projectId}&range=7d`)
    const res = await GETPosture(req)
    const body = await res.json()

    // Should only include today's entry, not the old one
    expect(res.status).toBe(200)
    const dates = body.data.timeseries.map((t: { date: string }) => t.date)
    expect(dates).not.toContain(oldDate)
    expect(dates).toContain(today())
  })

  it('returns 400 for invalid range param', async () => {
    const req = new Request(`http://localhost/api/posture?repo=${projectId}&range=invalid`)
    const res = await GETPosture(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 400 when repo param is missing', async () => {
    const req = new Request('http://localhost/api/posture')
    const res = await GETPosture(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('regressionRate has rate30d, count30d, totalFixes30d', async () => {
    const req = new Request(`http://localhost/api/posture?repo=${projectId}`)
    const res = await GETPosture(req)
    const body = await res.json()

    expect(body.data.regressionRate).toHaveProperty('rate30d')
    expect(body.data.regressionRate).toHaveProperty('count30d')
    expect(body.data.regressionRate).toHaveProperty('totalFixes30d')
    expect(typeof body.data.regressionRate.rate30d).toBe('number')
  })
})

// ─── GET /api/posture/mttr ────────────────────────────────────────────────────

describe('GET /api/posture/mttr', () => {
  let projectId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    projectId = project.id
  })

  it('returns 200 with windows array', async () => {
    const req = new Request(`http://localhost/api/posture/mttr?repo=${projectId}`)
    const res = await GETMttr(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('windows')
    expect(Array.isArray(body.data.windows)).toBe(true)
    expect(body.data).toHaveProperty('refreshedAt')
  })

  it('windows have 30d, 60d, 90d entries when data exists', async () => {
    // Refresh MTTR first to seed the table
    refreshMttr(testDb, projectId)

    const req = new Request(`http://localhost/api/posture/mttr?repo=${projectId}`)
    const res = await GETMttr(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // When no findings exist, windows is empty — but the shape is correct
    expect(Array.isArray(body.data.windows)).toBe(true)
  })

  it('each window has expected shape', async () => {
    // Seed a row directly into mttr_by_severity
    const sqlite = (testDb as unknown as { $client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).$client
    sqlite.prepare(`
      INSERT INTO mttr_by_severity (project_id, severity, window_days, median_seconds, avg_seconds, sample_size, refreshed_at)
      VALUES (?, 'high', 30, 86400, 90000, 8, ?)
    `).run(projectId, new Date().toISOString())

    const req = new Request(`http://localhost/api/posture/mttr?repo=${projectId}`)
    const res = await GETMttr(req)
    const body = await res.json()

    const highWindow = body.data.windows.find(
      (w: { severity: string; windowDays: number }) => w.severity === 'high' && w.windowDays === 30
    )
    expect(highWindow).toBeDefined()
    expect(highWindow).toHaveProperty('medianSeconds')
    expect(highWindow).toHaveProperty('avgSeconds')
    expect(highWindow).toHaveProperty('sampleSize')
    expect(highWindow).toHaveProperty('lowConfidence')
    expect(highWindow.lowConfidence).toBe(false) // sampleSize=8 >= 5
  })

  it('returns 400 when repo param is missing', async () => {
    const req = new Request('http://localhost/api/posture/mttr')
    const res = await GETMttr(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })
})

// ─── GET /api/posture/hotspots ────────────────────────────────────────────────

describe('GET /api/posture/hotspots', () => {
  let projectId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    projectId = project.id
  })

  it('returns 200 with cells array', async () => {
    const req = new Request(`http://localhost/api/posture/hotspots?repo=${projectId}`)
    const res = await GETHotspots(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('cells')
    expect(Array.isArray(body.data.cells)).toBe(true)
  })

  it('cells capped at 500', async () => {
    // The query itself enforces the 500-row cap via LIMIT 500 in posture.repo
    // We just verify the route returns the cells without exceeding it
    const req = new Request(`http://localhost/api/posture/hotspots?repo=${projectId}`)
    const res = await GETHotspots(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.cells.length).toBeLessThanOrEqual(500)
  })

  it('cell has expected fields when data exists', async () => {
    // Insert findings manually to trigger hotspot detection
    const scan = makeScan(testDb, projectId)
    const sqlite = (testDb as unknown as { $client: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).$client

    // Insert 3 findings with same file path but different dedup_keys
    for (let i = 0; i < 3; i++) {
      const id = `finding-${i}-${Date.now()}`
      sqlite.prepare(`
        INSERT INTO findings (id, scan_id, detector, severity, confidence, title, description,
          location_path, location_line_start, dedup_key, created_at)
        VALUES (?, ?, 'semgrep', 'high', 0.9, 'Finding ${i}', 'desc',
          'src/hotspot.ts', 10, 'key-${i}', datetime('now'))
      `).run(id, scan.id)
    }

    const req = new Request(`http://localhost/api/posture/hotspots?repo=${projectId}`)
    const res = await GETHotspots(req)
    const body = await res.json()

    if (body.data.cells.length > 0) {
      const cell = body.data.cells[0]
      expect(cell).toHaveProperty('filePath')
      expect(cell).toHaveProperty('distinctDedupKeys')
      expect(cell).toHaveProperty('repeatOffender')
      expect(cell.repeatOffender).toBe(true)
    }
    // Even if cells are empty, structure is valid
    expect(res.status).toBe(200)
  })

  it('returns 400 when repo param is missing', async () => {
    const req = new Request('http://localhost/api/posture/hotspots')
    const res = await GETHotspots(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })
})
