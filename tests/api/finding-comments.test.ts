/**
 * tests/api/finding-comments.test.ts
 *
 * TDD RED → GREEN: T-028 — API routes for finding comments
 *
 * Covers:
 * - GET returns array of comments
 * - POST creates + returns comment
 * - Malformed body → 422 (mapped as 400 INVALID_INPUT)
 * - POST to non-existent finding → 404
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

import {
  GET,
  POST,
} from '@/app/api/findings/[id]/comments/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/findings/[id]/comments', () => {
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    const finding = insertFinding(testDb, {
      scanId: scan.id,
      detector: 'semgrep',
      severity: 'high',
      confidence: 0.9,
      title: 'SQL Injection',
      description: '',
      locationPath: 'src/db.ts',
      locationLineStart: 10,
    })
    findingId = finding.id
  })

  it('returns 200 with empty array when no comments exist', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/comments`)
    const res = await GET(req, makeContext(findingId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(0)
  })

  it('returns 200 with comments array after POST', async () => {
    // First create a comment via POST
    const postReq = new Request(`http://localhost/api/findings/${findingId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Test comment', actor: 'alice@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(postReq, makeContext(findingId))

    const getReq = new Request(`http://localhost/api/findings/${findingId}/comments`)
    const res = await GET(getReq, makeContext(findingId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].body).toBe('Test comment')
  })
})

describe('POST /api/findings/[id]/comments', () => {
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    const finding = insertFinding(testDb, {
      scanId: scan.id,
      detector: 'semgrep',
      severity: 'high',
      confidence: 0.9,
      title: 'SQL Injection',
      description: '',
      locationPath: 'src/db.ts',
      locationLineStart: 10,
    })
    findingId = finding.id
  })

  it('creates and returns the comment on valid request', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Needs urgent fix', actor: 'alice@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, makeContext(findingId))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.body).toBe('Needs urgent fix')
    expect(data.data.actor).toBe('alice@example.com')
    expect(data.data.findingId).toBe(findingId)
  })

  it('returns 400 when body is missing required fields (malformed)', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: '' }), // missing actor, empty body
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, makeContext(findingId))
    expect(res.status).toBe(400)
  })

  it('returns 404 when finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/non-existent/comments', {
      method: 'POST',
      body: JSON.stringify({ body: 'A comment', actor: 'alice@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req, makeContext('non-existent'))
    expect(res.status).toBe(404)
  })
})
