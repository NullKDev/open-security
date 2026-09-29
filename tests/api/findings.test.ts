/**
 * tests/api/findings.test.ts
 *
 * Tests for GET /api/findings, GET /api/findings/[id],
 * PATCH /api/findings/[id]
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return {
    ...mod,
    getDb: () => testDb,
  }
})

// Mock the runner and shared bus to prevent real pipeline execution
vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

import { GET as GETFindings } from '@/app/api/findings/route'
import { GET as GETFindingById, PATCH as PATCHFinding, DELETE as DELETEFinding } from '@/app/api/findings/[id]/route'

function makeFinding(db: ReturnType<typeof createTestDb>, scanId: string, overrides: Partial<Parameters<typeof insertFinding>[1]> = {}) {
  return insertFinding(db, {
    scanId,
    detector: 'test-detector',
    severity: overrides.severity ?? 'high',
    confidence: 0.9,
    title: 'Test Finding',
    description: 'A test finding',
    locationPath: 'src/test.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

describe('GET /api/findings', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when scanId is missing', async () => {
    const req = new Request('http://localhost/api/findings')
    const res = await GETFindings(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 200 paginated findings for a valid scanId', async () => {
    makeFinding(testDb, scanId)
    makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings?scanId=${scanId}`)
    const res = await GETFindings(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(2)
    expect(body.meta).toBeDefined()
    expect(body.meta.total).toBe(2)
  })

  it('returns correct meta.cursor when there are more pages', async () => {
    // Create 5 findings, fetch with limit=2
    for (let i = 0; i < 5; i++) {
      makeFinding(testDb, scanId)
    }

    const req = new Request(`http://localhost/api/findings?scanId=${scanId}&limit=2`)
    const res = await GETFindings(req)
    const body = await res.json()

    expect(body.data.length).toBe(2)
    expect(body.meta.cursor).toBeTruthy()
  })

  it('filters by severity=high', async () => {
    makeFinding(testDb, scanId, { severity: 'high' })
    makeFinding(testDb, scanId, { severity: 'low' })
    makeFinding(testDb, scanId, { severity: 'high' })

    const req = new Request(`http://localhost/api/findings?scanId=${scanId}&severity=high`)
    const res = await GETFindings(req)
    const body = await res.json()

    expect(body.data.length).toBe(2)
    expect(body.data.every((f: { severity: string }) => f.severity === 'high')).toBe(true)
  })

  it('filters by fpFiltered=true', async () => {
    makeFinding(testDb, scanId, { fpFiltered: false })
    makeFinding(testDb, scanId, { fpFiltered: true })
    makeFinding(testDb, scanId, { fpFiltered: true })

    const req = new Request(`http://localhost/api/findings?scanId=${scanId}&fpFiltered=true`)
    const res = await GETFindings(req)
    const body = await res.json()

    expect(body.data.length).toBe(2)
    expect(body.data.every((f: { fpFiltered: boolean }) => f.fpFiltered === true)).toBe(true)
  })
})

describe('GET /api/findings/[id]', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 200 for an existing finding', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}`)
    const res = await GETFindingById(req, { params: Promise.resolve({ id: finding.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(finding.id)
  })

  it('returns 404 for a non-existent finding', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent')
    const res = await GETFindingById(req, { params: Promise.resolve({ id: 'nonexistent' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

describe('PATCH /api/findings/[id]', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('updates falsePositive to true', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ falsePositive: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCHFinding(req, { params: Promise.resolve({ id: finding.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.fpFiltered).toBe(true)
  })

  it('updates tags', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ tags: ['reviewed', 'critical'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCHFinding(req, { params: Promise.resolve({ id: finding.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 400 for invalid fields (e.g. severity is not in schema)', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCHFinding(req, { params: Promise.resolve({ id: finding.id }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 404 for non-existent finding', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent', {
      method: 'PATCH',
      body: JSON.stringify({ falsePositive: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCHFinding(req, { params: Promise.resolve({ id: 'nonexistent' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

describe('DELETE /api/findings/[id]', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 200 and deletes an existing finding', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}`, {
      method: 'DELETE',
    })
    const res = await DELETEFinding(req, { params: Promise.resolve({ id: finding.id }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.deleted).toBe(true)

    // Verify it's actually gone
    const getReq = new Request(`http://localhost/api/findings/${finding.id}`)
    const getRes = await GETFindingById(getReq, { params: Promise.resolve({ id: finding.id }) })
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for non-existent finding', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent', {
      method: 'DELETE',
    })
    const res = await DELETEFinding(req, { params: Promise.resolve({ id: 'nonexistent' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
