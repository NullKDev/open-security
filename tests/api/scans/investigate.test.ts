/**
 * tests/api/scans/investigate.test.ts
 *
 * TDD: T-047 (RED) → T-048 (GREEN)
 * Tests for investigation console endpoints:
 * - POST /api/scans/[id]/inject-prompt
 * - POST /api/scans/[id]/edit-plan
 * - POST /api/scans/[id]/reject-tool
 * - POST /api/scans/[id]/fork
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan, updateScanStatus } from '@/lib/repos/scans.repo'

// ---------------------------------------------------------------------------
// In-memory DB factory (actual — not mocked)
// ---------------------------------------------------------------------------

import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { runMigrations } from '@/lib/db/migrate'

function makeTestDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock getDb to return our in-memory test DB
let testDb: ReturnType<typeof makeTestDb>

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => testDb),
}))

// Mock PendingTurnQueue to capture enqueued turns
const mockEnqueue = vi.fn()
vi.mock('@/lib/providers/transport/pending-turn-queue', () => ({
  forScan: vi.fn(() => ({ enqueue: mockEnqueue })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request
}

function makeContext(scanId: string) {
  return { params: Promise.resolve({ id: scanId }) }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let runningScanId: string
let pendingScanId: string

beforeEach(async () => {
  vi.clearAllMocks()
  testDb = makeTestDb()
  const project = createProject(testDb, {
    name: 'test',
    sourceKind: 'local',
    sourceRef: '/tmp/repo',
  })
  const runningScan = createScan(testDb, { projectId: project.id })
  updateScanStatus(testDb, runningScan.id, 'running')
  runningScanId = runningScan.id

  const pendingScan = createScan(testDb, { projectId: project.id })
  pendingScanId = pendingScan.id
})

// ===========================================================================
// inject-prompt
// ===========================================================================

describe('POST /api/scans/[id]/inject-prompt', () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    const mod = await import('@/app/api/scans/[id]/inject-prompt/route')
    POST = mod.POST
  })

  it('returns 202 and enqueues a user_injection turn for running scan', async () => {
    const req = makeRequest({ content: 'look at file.ts' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inject', content: 'look at file.ts' }),
    )
  })

  it('returns 409 when scan is not running', async () => {
    const req = makeRequest({ content: 'look at file.ts' })
    const ctx = makeContext(pendingScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(409)
  })

  it('returns 404 when scan does not exist', async () => {
    const req = makeRequest({ content: 'look at file.ts' })
    const ctx = makeContext('nonexistent-scan')

    const response = await POST(req, ctx)

    expect(response.status).toBe(404)
  })

  it('returns 400 when content is missing', async () => {
    const req = makeRequest({})
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(400)
  })
})

// ===========================================================================
// edit-plan
// ===========================================================================

describe('POST /api/scans/[id]/edit-plan', () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    const mod = await import('@/app/api/scans/[id]/edit-plan/route')
    POST = mod.POST
  })

  it('returns 202 and enqueues a plan_edit turn for running scan', async () => {
    const req = makeRequest({ stepIndex: 1, newContent: 'Check for SQL injection' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inject' }),
    )
  })

  it('returns 409 when scan is not running', async () => {
    const req = makeRequest({ stepIndex: 0, newContent: 'new step' })
    const ctx = makeContext(pendingScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(409)
  })

  it('returns 404 when scan does not exist', async () => {
    const req = makeRequest({ stepIndex: 0, newContent: 'new step' })
    const ctx = makeContext('nonexistent-scan')

    const response = await POST(req, ctx)

    expect(response.status).toBe(404)
  })

  it('returns 400 when stepIndex is missing', async () => {
    const req = makeRequest({ newContent: 'new step' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(400)
  })

  it('returns 400 when newContent is missing', async () => {
    const req = makeRequest({ stepIndex: 0 })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(400)
  })
})

// ===========================================================================
// reject-tool
// ===========================================================================

describe('POST /api/scans/[id]/reject-tool', () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    const mod = await import('@/app/api/scans/[id]/reject-tool/route')
    POST = mod.POST
  })

  it('returns 202 and enqueues a tool rejection for running scan', async () => {
    const req = makeRequest({ toolCallId: 'tc-abc123', reason: 'too risky' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inject' }),
    )
  })

  it('returns 202 without optional reason', async () => {
    const req = makeRequest({ toolCallId: 'tc-abc123' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
  })

  it('returns 409 when scan is not running', async () => {
    const req = makeRequest({ toolCallId: 'tc-abc123' })
    const ctx = makeContext(pendingScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(409)
  })

  it('returns 404 when scan does not exist', async () => {
    const req = makeRequest({ toolCallId: 'tc-abc123' })
    const ctx = makeContext('nonexistent-scan')

    const response = await POST(req, ctx)

    expect(response.status).toBe(404)
  })

  it('returns 400 when toolCallId is missing', async () => {
    const req = makeRequest({ reason: 'too risky' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(400)
  })
})

// ===========================================================================
// fork
// ===========================================================================

describe('POST /api/scans/[id]/fork', () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    const mod = await import('@/app/api/scans/[id]/fork/route')
    POST = mod.POST
  })

  it('returns 202 with childScanId for running scan', async () => {
    const req = makeRequest({})
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toHaveProperty('childScanId')
    expect(typeof body.childScanId).toBe('string')
  })

  it('returns 202 with childScanId when forkEventId is provided', async () => {
    const req = makeRequest({ forkEventId: 'evt-abc123' })
    const ctx = makeContext(runningScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toHaveProperty('childScanId')
  })

  it('returns 409 when scan is not running', async () => {
    const req = makeRequest({})
    const ctx = makeContext(pendingScanId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(409)
  })

  it('returns 404 when scan does not exist', async () => {
    const req = makeRequest({})
    const ctx = makeContext('nonexistent-scan')

    const response = await POST(req, ctx)

    expect(response.status).toBe(404)
  })
})
