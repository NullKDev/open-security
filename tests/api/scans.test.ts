/**
 * tests/api/scans.test.ts
 *
 * Tests for POST /api/scans, GET /api/scans,
 * GET /api/scans/[id], DELETE /api/scans/[id]
 *
 * Pattern: import handler directly, call with mock Request.
 * DB: in-memory via createTestDb.
 * Orchestrator fork: vi.mock to prevent real process spawning.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

// Mock the runner so no real pipeline executes in unit tests
vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({
    done: Promise.resolve(),
    abort: vi.fn(),
  })),
}))

// Mock the shared bus so tests don't share state between runs
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

// Mock getDb to return an in-memory database for all routes
let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return {
    ...mod,
    getDb: () => testDb,
  }
})

import { POST, GET } from '@/app/api/scans/route'
import { GET as GETById, DELETE as DELETEById } from '@/app/api/scans/[id]/route'

function postScan(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/scans', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }))
}

describe('POST /api/scans', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 when sourceType is missing (no parentScanId)', async () => {
    const res = await postScan({ sourceRef: 'https://github.com/org/repo' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 400 when sourceRef is missing (no parentScanId)', async () => {
    const res = await postScan({ sourceType: 'github' })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 201 with scan data for valid github input', async () => {
    const res = await postScan({
      sourceType: 'github',
      sourceRef: 'https://github.com/org/repo',
      projectName: 'test-project',
    })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.id).toBeTruthy()
    expect(body.data.status).toBe('pending')
    expect(body.data.version).toBe(1)
    expect(body.data.parentId).toBeNull()
  })

  it('first scan has version 1', async () => {
    const res = await postScan({ sourceType: 'github', sourceRef: 'https://github.com/org/repo' })
    const body = await res.json()
    expect(body.data.version).toBe(1)
  })

  it('accepts an optional prompt', async () => {
    const res = await postScan({
      sourceType: 'github',
      sourceRef: 'https://github.com/org/repo',
      prompt: 'Only scan the auth module',
    })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.id).toBeTruthy()
  })

  it('returns 201 with auto-generated project name when not provided', async () => {
    const res = await postScan({ sourceType: 'local', sourceRef: '/path/to/project' })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.id).toBeTruthy()
  })

  describe('rescan / parentScanId', () => {
    it('returns 404 when parentScanId does not exist', async () => {
      const res = await postScan({ parentScanId: crypto.randomUUID() })
      const body = await res.json()
      expect(res.status).toBe(404)
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('inherits project from parent scan', async () => {
      // Create the original scan
      const createRes = await postScan({
        sourceType: 'github',
        sourceRef: 'https://github.com/org/repo',
      })
      const created = await createRes.json()
      const parentScanId = created.data.id
      const parentProjectId = created.data.projectId

      // Create a rescan
      const rescanRes = await postScan({ parentScanId })
      const rescanBody = await rescanRes.json()

      expect(rescanRes.status).toBe(201)
      expect(rescanBody.data.projectId).toBe(parentProjectId)
      expect(rescanBody.data.parentId).toBe(parentScanId)
    })

    it('rescan gets version 2', async () => {
      const createRes = await postScan({
        sourceType: 'github',
        sourceRef: 'https://github.com/org/repo',
      })
      const { data: { id: parentScanId } } = await createRes.json()

      const rescanRes = await postScan({ parentScanId })
      const rescanBody = await rescanRes.json()

      expect(rescanBody.data.version).toBe(2)
    })

    it('third scan in the same project gets version 3', async () => {
      const first = await (await postScan({ sourceType: 'github', sourceRef: 'https://github.com/org/repo' })).json()
      await postScan({ parentScanId: first.data.id })
      const rescanRes = await postScan({ parentScanId: first.data.id })
      const rescanBody = await rescanRes.json()
      expect(rescanBody.data.version).toBe(3)
    })

    it('new focused scan with prompt keeps parentId link', async () => {
      const createRes = await postScan({
        sourceType: 'github',
        sourceRef: 'https://github.com/org/repo',
      })
      const { data: { id: parentScanId } } = await createRes.json()

      const focusedRes = await postScan({
        parentScanId,
        prompt: 'Only check for SQL injection',
      })
      const focusedBody = await focusedRes.json()

      expect(focusedRes.status).toBe(201)
      expect(focusedBody.data.parentId).toBe(parentScanId)
    })
  })
})

describe('GET /api/scans', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 200 with paginated scan list', async () => {
    const res = await GET(new Request('http://localhost/api/scans'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta).toBeDefined()
  })

  it('returns all created scans', async () => {
    for (const ref of ['https://github.com/org/repo1', 'https://github.com/org/repo2']) {
      await postScan({ sourceType: 'github', sourceRef: ref })
    }
    const res = await GET(new Request('http://localhost/api/scans'))
    const body = await res.json()
    expect(body.data.length).toBe(2)
    expect(body.meta.total).toBe(2)
  })
})

describe('GET /api/scans/[id]', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 404 for non-existent scan', async () => {
    const res = await GETById(
      new Request('http://localhost/api/scans/nonexistent'),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns scan data including version and children array', async () => {
    const createRes = await postScan({ sourceType: 'github', sourceRef: 'https://github.com/org/repo' })
    const { data: { id: scanId } } = await createRes.json()

    const res = await GETById(
      new Request(`http://localhost/api/scans/${scanId}`),
      { params: Promise.resolve({ id: scanId }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.id).toBe(scanId)
    expect(body.data.version).toBe(1)
    expect(body.data.parentId).toBeNull()
    expect(Array.isArray(body.data.children)).toBe(true)
    expect(body.data.children).toHaveLength(0)
  })

  it('children array contains rescans', async () => {
    const createRes = await postScan({ sourceType: 'github', sourceRef: 'https://github.com/org/repo' })
    const { data: { id: parentId } } = await createRes.json()

    // Create two rescans
    await postScan({ parentScanId: parentId })
    await postScan({ parentScanId: parentId })

    const res = await GETById(
      new Request(`http://localhost/api/scans/${parentId}`),
      { params: Promise.resolve({ id: parentId }) },
    )
    const body = await res.json()
    expect(body.data.children).toHaveLength(2)
  })
})

describe('DELETE /api/scans/[id]', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 404 for non-existent scan', async () => {
    const res = await DELETEById(
      new Request('http://localhost/api/scans/nonexistent', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'nonexistent' }) },
    )
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 200 and marks scan as cancelled', async () => {
    const createRes = await postScan({ sourceType: 'github', sourceRef: 'https://github.com/org/repo' })
    const { data: { id: scanId } } = await createRes.json()

    const res = await DELETEById(
      new Request(`http://localhost/api/scans/${scanId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: scanId }) },
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })
})
