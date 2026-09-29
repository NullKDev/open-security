/**
 * tests/api/findings-dismiss.test.ts
 *
 * Tests for POST /api/findings/[id]/dismiss
 * (dismiss a finding) and DELETE /api/findings/[id]/dismiss (undo dismissal)
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

import {
  POST as POSTDismiss,
  DELETE as DELETEDismiss,
} from '@/app/api/findings/[id]/dismiss/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function makeFinding(
  db: ReturnType<typeof createTestDb>,
  scanId: string,
  overrides: Partial<Parameters<typeof insertFinding>[1]> = {},
) {
  return insertFinding(db, {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: overrides.title ?? 'SQL Injection',
    description: 'Test finding',
    locationPath: overrides.locationPath ?? 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

describe('POST /api/findings/[id]/dismiss', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 200 with dismissal record on valid request', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'This is a false positive test', fpType: 'not_vulnerable' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTDismiss(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.findingId).toBe(finding.id)
    expect(body.data.fpType).toBe('not_vulnerable')
  })

  it('returns 400 if reason is too short (< 10 chars)', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'short', fpType: 'not_vulnerable' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTDismiss(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 400 if fpType is invalid', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'This is a valid reason string', fpType: 'invalid_type' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTDismiss(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 404 if finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent/dismiss', {
      method: 'POST',
      body: JSON.stringify({ reason: 'This is a false positive entry', fpType: 'accepted_risk' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTDismiss(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 400 if body is invalid JSON', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTDismiss(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('accepts all valid fpType values', async () => {
    const validTypes = ['not_vulnerable', 'accepted_risk', 'wont_fix', 'duplicate']

    for (const fpType of validTypes) {
      const finding = makeFinding(testDb, scanId, {
        title: `Finding for ${fpType}`,
        locationPath: `src/${fpType}.ts`,
      })

      const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'This is a valid reason text', fpType }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POSTDismiss(req, makeContext(finding.id))
      expect(res.status).toBe(200)
    }
  })
})

describe('DELETE /api/findings/[id]/dismiss', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id
  })

  it('returns 200 and undoes the active dismissal', async () => {
    const finding = makeFinding(testDb, scanId)

    // First dismiss it
    const dismissReq = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Test dismissal reason here', fpType: 'not_vulnerable' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const dismissRes = await POSTDismiss(dismissReq, makeContext(finding.id))
    expect(dismissRes.status).toBe(200)

    // Then undo it
    const undoReq = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'DELETE',
    })
    const undoRes = await DELETEDismiss(undoReq, makeContext(finding.id))
    const undoBody = await undoRes.json()

    expect(undoRes.status).toBe(200)
    expect(undoBody.success).toBe(true)
    expect(undoBody.data.undoneAt).toBeTruthy()
  })

  it('returns 404 if no active dismissal exists for the finding', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(`http://localhost/api/findings/${finding.id}/dismiss`, {
      method: 'DELETE',
    })
    const res = await DELETEDismiss(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 if finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent/dismiss', {
      method: 'DELETE',
    })
    const res = await DELETEDismiss(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
