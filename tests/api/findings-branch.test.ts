/**
 * tests/api/findings-branch.test.ts
 *
 * Tests for POST /api/findings/[id]/branch (trigger branch creation)
 * and GET /api/findings/[id]/branch (get branch state)
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

const mockCreateFixBranch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

vi.mock('@/lib/remediation/branch-service', () => ({
  createFixBranch: mockCreateFixBranch,
}))

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

import {
  POST as POSTBranch,
  GET as GETBranch,
} from '@/app/api/findings/[id]/branch/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function makeFinding(
  db: ReturnType<typeof createTestDb>,
  scanId: string,
  withPatch = false,
  uniqueTitle = 'SQL Injection',
  uniquePath = 'src/db.ts',
) {
  return insertFinding(db, {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: uniqueTitle,
    description: 'Test finding',
    locationPath: uniquePath,
    locationLineStart: 10,
    patchDiff: withPatch ? 'diff --git a/src/db.ts\n--- a/src/db.ts\n+++ b/src/db.ts\n' : null,
  })
}

describe('POST /api/findings/[id]/branch', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 202 immediately for finding with patch', async () => {
    const finding = makeFinding(testDb, scanId, true)

    const req = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTBranch(req, makeContext(finding.id))

    expect(res.status).toBe(202)
  })

  it('returns branch record with status=pending in response body', async () => {
    const finding = makeFinding(testDb, scanId, true)

    const req = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTBranch(req, makeContext(finding.id))
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.status).toBe('pending')
    expect(body.data.findingId).toBe(finding.id)
  })

  it('returns 400 if finding has no patchDiff', async () => {
    const finding = makeFinding(testDb, scanId, false)

    const req = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTBranch(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 404 if finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent/branch', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTBranch(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('calls createFixBranch asynchronously (fire-and-forget)', async () => {
    const finding = makeFinding(testDb, scanId, true)

    const req = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    await POSTBranch(req, makeContext(finding.id))

    // Give microtask queue a tick to schedule the async work
    await new Promise((r) => setTimeout(r, 0))

    expect(mockCreateFixBranch).toHaveBeenCalledTimes(1)
  })

  it('returns 409 if non-terminal branch record already exists', async () => {
    const finding = makeFinding(testDb, scanId, true)

    // Create first branch
    const req1 = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    await POSTBranch(req1, makeContext(finding.id))

    // Attempt second branch creation
    const req2 = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res2 = await POSTBranch(req2, makeContext(finding.id))
    const body2 = await res2.json()

    expect(res2.status).toBe(409)
    expect(body2.error.code).toBe('CONFLICT')
  })
})

describe('GET /api/findings/[id]/branch', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 200 with branch state after branch creation is triggered', async () => {
    const finding = makeFinding(testDb, scanId, true)

    // Trigger branch creation first
    const postReq = new Request(`http://localhost/api/findings/${finding.id}/branch`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    await POSTBranch(postReq, makeContext(finding.id))

    // Now poll the state
    const getReq = new Request(`http://localhost/api/findings/${finding.id}/branch`)
    const getRes = await GETBranch(getReq, makeContext(finding.id))
    const body = await getRes.json()

    expect(getRes.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.findingId).toBe(finding.id)
    expect(typeof body.data.status).toBe('string')
  })

  it('returns 404 if no branch record exists for the finding', async () => {
    const finding = makeFinding(testDb, scanId, false)

    const req = new Request(`http://localhost/api/findings/${finding.id}/branch`)
    const res = await GETBranch(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 if finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent/branch')
    const res = await GETBranch(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
