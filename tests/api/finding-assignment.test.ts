/**
 * tests/api/finding-assignment.test.ts
 *
 * TDD RED → GREEN: T-029 — API route for finding assignment
 *
 * Covers:
 * - PUT assigns a finding to an assignee
 * - PUT null assignee unassigns the finding
 * - 404 on missing finding
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

import { PUT } from '@/app/api/findings/[id]/assignment/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

describe('PUT /api/findings/[id]/assignment', () => {
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

  it('assigns the finding and returns assignment record', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/assignment`, {
      method: 'PUT',
      body: JSON.stringify({ assignee: 'alice@example.com', actor: 'manager@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await PUT(req, makeContext(findingId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.assignee).toBe('alice@example.com')
    expect(body.data.actor).toBe('manager@example.com')
    expect(body.data.findingId).toBe(findingId)
  })

  it('unassigns the finding when assignee is null', async () => {
    // First assign
    const assignReq = new Request(`http://localhost/api/findings/${findingId}/assignment`, {
      method: 'PUT',
      body: JSON.stringify({ assignee: 'alice@example.com', actor: 'manager@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await PUT(assignReq, makeContext(findingId))

    // Then unassign
    const unassignReq = new Request(`http://localhost/api/findings/${findingId}/assignment`, {
      method: 'PUT',
      body: JSON.stringify({ assignee: null, actor: 'manager@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await PUT(unassignReq, makeContext(findingId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.unassigned).toBe(true)
  })

  it('returns 404 when finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/non-existent/assignment', {
      method: 'PUT',
      body: JSON.stringify({ assignee: 'alice@example.com', actor: 'manager@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await PUT(req, makeContext('non-existent'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when actor is missing', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/assignment`, {
      method: 'PUT',
      body: JSON.stringify({ assignee: 'alice@example.com' }), // missing actor
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await PUT(req, makeContext(findingId))
    expect(res.status).toBe(400)
  })
})
