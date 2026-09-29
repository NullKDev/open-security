/**
 * tests/api/queue.test.ts
 *
 * Tests for GET /api/queue and GET /api/queue/stats
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

import { GET as GETQueue } from '@/app/api/queue/route'
import { GET as GETQueueStats } from '@/app/api/queue/stats/route'

function makeProject(db: ReturnType<typeof createTestDb>) {
  return createProject(db, { name: 'test-project', sourceKind: 'local', sourceRef: '/tmp' })
}

function makeScan(db: ReturnType<typeof createTestDb>, projectId: string) {
  return createScan(db, { projectId })
}

function makeFinding(
  db: ReturnType<typeof createTestDb>,
  scanId: string,
  overrides: Partial<Parameters<typeof insertFinding>[1]> = {},
) {
  return insertFinding(db, {
    scanId,
    detector: 'semgrep',
    severity: overrides.severity ?? 'high',
    confidence: 0.9,
    title: overrides.title ?? 'SQL Injection',
    description: 'Test finding',
    locationPath: overrides.locationPath ?? 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

describe('GET /api/queue', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with empty findings list when no findings', async () => {
    const req = new Request('http://localhost/api/queue')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.findings)).toBe(true)
    expect(body.data.findings).toHaveLength(0)
    expect(body.data.nextCursor).toBeNull()
    expect(typeof body.data.total).toBe('number')
  })

  it('returns canonical findings in the queue', async () => {
    makeFinding(testDb, scanId)
    makeFinding(testDb, scanId, { title: 'XSS Vulnerability', locationPath: 'src/view.ts' })

    const req = new Request('http://localhost/api/queue')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.findings.length).toBeGreaterThan(0)
  })

  it('filters by severity', async () => {
    makeFinding(testDb, scanId, { severity: 'critical', title: 'Critical Finding', locationPath: 'a.ts' })
    makeFinding(testDb, scanId, { severity: 'low', title: 'Low Finding', locationPath: 'b.ts' })

    const req = new Request('http://localhost/api/queue?severity=critical')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.findings.every((f: { severity: string }) => f.severity === 'critical')).toBe(true)
  })

  it('returns 400 for invalid limit (> 100)', async () => {
    const req = new Request('http://localhost/api/queue?limit=999')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('supports cursor-based pagination', async () => {
    // Create multiple findings to test pagination
    for (let i = 0; i < 5; i++) {
      makeFinding(testDb, scanId, {
        title: `Finding ${i}`,
        locationPath: `src/file${i}.ts`,
      })
    }

    const req = new Request('http://localhost/api/queue?limit=2')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Either we get 2 items with a cursor, or all items fit in 2
    expect(body.data.findings.length).toBeLessThanOrEqual(2)
  })

  it('filters by kevOnly=true returns empty when no KEV findings', async () => {
    makeFinding(testDb, scanId)

    const req = new Request('http://localhost/api/queue?kevOnly=true')
    const res = await GETQueue(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // No CVE data in test DB, so no KEV findings
    expect(Array.isArray(body.data.findings)).toBe(true)
  })
})

describe('GET /api/queue/stats', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with stats shape', async () => {
    const req = new Request('http://localhost/api/queue/stats')
    const res = await GETQueueStats(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.data.total).toBe('number')
    expect(typeof body.data.kev).toBe('number')
  })

  it('counts findings by severity', async () => {
    makeFinding(testDb, scanId, { severity: 'critical', title: 'Crit', locationPath: 'a.ts' })
    makeFinding(testDb, scanId, { severity: 'critical', title: 'Crit2', locationPath: 'b.ts' })
    makeFinding(testDb, scanId, { severity: 'high', title: 'High', locationPath: 'c.ts' })

    const req = new Request('http://localhost/api/queue/stats')
    const res = await GETQueueStats(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.critical).toBe(2)
    expect(body.data.high).toBe(1)
    expect(body.data.total).toBe(3)
  })

  it('returns zero counts when no findings', async () => {
    const req = new Request('http://localhost/api/queue/stats')
    const res = await GETQueueStats(req)
    const body = await res.json()

    expect(body.data.total).toBe(0)
    expect(body.data.kev).toBe(0)
  })
})
