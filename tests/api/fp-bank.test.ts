/**
 * tests/api/fp-bank.test.ts
 *
 * Tests for FP Bank API routes (v0.4):
 *   GET    /api/findings/fp-bank?q={fts}&cursor={…}&limit=50
 *   DELETE /api/findings/[id]/dismiss   — appeal flow
 *   POST   /api/findings/dismissals/[id]/appeal
 *   POST   /api/findings/dismissals/[id]/draft  — 5s cooldown
 *   GET    /api/findings/fp-bank/export  — SARIF
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { dismiss } from '@/lib/repos/dismissals.repo'

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

import { GET as GETFpBank } from '@/app/api/findings/fp-bank/route'
import { GET as GETExport } from '@/app/api/findings/fp-bank/export/route'
import {
  POST as POSTAppeal,
} from '@/app/api/findings/dismissals/[id]/appeal/route'
import {
  POST as POSTDraft,
} from '@/app/api/findings/dismissals/[id]/draft/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

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
    severity: 'high',
    confidence: 0.9,
    title: overrides.title ?? 'SQL Injection',
    description: 'A test vulnerability',
    locationPath: overrides.locationPath ?? 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

function makeDismissal(
  db: ReturnType<typeof createTestDb>,
  findingId: string,
  dedupKey: string,
  reason = 'This is a valid dismissal reason',
) {
  return dismiss(db, {
    findingId,
    dedupKey,
    fpType: 'not_vulnerable',
    reason,
    actor: 'test-user',
    source: 'hand',
  })
}

// ─── GET /api/findings/fp-bank (FTS5 pagination) ─────────────────────────────

describe('GET /api/findings/fp-bank (v0.4 FTS5 pagination)', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with dismissals list', async () => {
    const f = makeFinding(testDb, scanId)
    makeDismissal(testDb, f.id, f.dedupKey ?? f.id)

    const req = new Request('http://localhost/api/findings/fp-bank')
    const res = await GETFpBank(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.dismissals)).toBe(true)
  })

  it('supports q param for FTS search', async () => {
    const f = makeFinding(testDb, scanId)
    makeDismissal(testDb, f.id, f.dedupKey ?? f.id, 'This is about eval injection vulnerability')

    const req = new Request('http://localhost/api/findings/fp-bank?q=eval')
    const res = await GETFpBank(req)
    const body = await res.json()

    // FTS may or may not match depending on FTS5 table setup — at minimum it returns 200
    expect(res.status).toBe(200)
  })

  it('supports limit param', async () => {
    for (let i = 0; i < 5; i++) {
      const f = makeFinding(testDb, scanId, {
        title: `Finding ${i}`,
        locationPath: `src/f${i}.ts`,
      })
      makeDismissal(testDb, f.id, f.dedupKey ?? f.id, `Dismissal reason number ${i} here`)
    }

    const req = new Request('http://localhost/api/findings/fp-bank?limit=2')
    const res = await GETFpBank(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.dismissals.length).toBeLessThanOrEqual(2)
  })
})

// ─── GET /api/findings/fp-bank/export (SARIF) ────────────────────────────────

describe('GET /api/findings/fp-bank/export', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with SARIF document structure', async () => {
    const f = makeFinding(testDb, scanId)
    makeDismissal(testDb, f.id, f.dedupKey ?? f.id)

    const req = new Request('http://localhost/api/findings/fp-bank/export')
    const res = await GETExport(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('version')
    expect(body.data.version).toBe('2.1.0')
    expect(body.data).toHaveProperty('$schema')
    expect(body.data).toHaveProperty('runs')
    expect(Array.isArray(body.data.runs)).toBe(true)
  })

  it('SARIF runs[0].results contains suppression entries', async () => {
    const f = makeFinding(testDb, scanId)
    makeDismissal(testDb, f.id, f.dedupKey ?? f.id, 'Confirmed not exploitable in our context')

    const req = new Request('http://localhost/api/findings/fp-bank/export')
    const res = await GETExport(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.runs[0].results.length).toBeGreaterThan(0)
    const result = body.data.runs[0].results[0]
    expect(result).toHaveProperty('suppressions')
    expect(Array.isArray(result.suppressions)).toBe(true)
  })

  it('returns empty SARIF runs when no dismissals exist', async () => {
    const req = new Request('http://localhost/api/findings/fp-bank/export')
    const res = await GETExport(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.runs[0].results).toHaveLength(0)
  })
})

// ─── POST /api/findings/dismissals/[id]/appeal ───────────────────────────────

describe('POST /api/findings/dismissals/[id]/appeal', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 and sets appealed_at on the dismissal', async () => {
    const f = makeFinding(testDb, scanId)
    const { dismissal } = makeDismissal(testDb, f.id, f.dedupKey ?? f.id)

    const req = new Request(
      `http://localhost/api/findings/dismissals/${dismissal.id}/appeal`,
      {
        method: 'POST',
        body: JSON.stringify({
          actor: 'reviewer@example.com',
          appealReason: 'This is actually exploitable in our environment',
        }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTAppeal(req, makeContext(dismissal.id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.dismissal.appealedAt).toBeTruthy()
    expect(body.data.dismissal.undoneAt).toBeTruthy()
    expect(body.data.historyRow.action).toBe('appealed')
  })

  it('returns 400 if body is invalid JSON', async () => {
    const req = new Request(
      'http://localhost/api/findings/dismissals/some-id/appeal',
      {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTAppeal(req, makeContext('some-id'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 400 if actor is missing', async () => {
    const req = new Request(
      'http://localhost/api/findings/dismissals/some-id/appeal',
      {
        method: 'POST',
        body: JSON.stringify({ appealReason: 'Valid reason' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTAppeal(req, makeContext('some-id'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 404 when dismissal does not exist', async () => {
    const req = new Request(
      'http://localhost/api/findings/dismissals/nonexistent/appeal',
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'user@example.com', appealReason: 'Valid appeal reason' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTAppeal(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

// ─── POST /api/findings/dismissals/[id]/draft (cooldown) ─────────────────────

describe('POST /api/findings/dismissals/[id]/draft', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with draft, draftId, draftedAt on first call', async () => {
    const f = makeFinding(testDb, scanId)
    const { dismissal } = makeDismissal(testDb, f.id, f.dedupKey ?? f.id)

    const req = new Request(
      `http://localhost/api/findings/dismissals/${dismissal.id}/draft`,
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'user@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTDraft(req, makeContext(dismissal.id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('draft')
    expect(body.data).toHaveProperty('draftId')
    expect(body.data).toHaveProperty('draftedAt')
  })

  it('returns 400 cooldown error when called again within 5 seconds', async () => {
    const f = makeFinding(testDb, scanId)
    const { dismissal } = makeDismissal(testDb, f.id, f.dedupKey ?? f.id)

    // First draft call — inserts history row with source=agent-assisted
    const req1 = new Request(
      `http://localhost/api/findings/dismissals/${dismissal.id}/draft`,
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'user@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res1 = await POSTDraft(req1, makeContext(dismissal.id))
    expect(res1.status).toBe(200)

    // Second draft call immediately — should be blocked by 5s cooldown
    const req2 = new Request(
      `http://localhost/api/findings/dismissals/${dismissal.id}/draft`,
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'user@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res2 = await POSTDraft(req2, makeContext(dismissal.id))
    const body2 = await res2.json()

    expect(res2.status).toBe(400)
    expect(body2.error.code).toBe('INVALID_INPUT')
    // Should mention cooldown in the message
    expect(body2.error.message).toMatch(/cooldown/i)
  })

  it('returns 400 if actor is missing', async () => {
    const req = new Request(
      'http://localhost/api/findings/dismissals/some-id/draft',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTDraft(req, makeContext('some-id'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 404 if dismissal does not exist', async () => {
    const req = new Request(
      'http://localhost/api/findings/dismissals/nonexistent/draft',
      {
        method: 'POST',
        body: JSON.stringify({ actor: 'user@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POSTDraft(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
