/**
 * tests/api/fix-and-prove.test.ts
 *
 * Tests for:
 *   POST /api/findings/[id]/verify  — trigger Fix & Prove triad
 *   GET  /api/findings/[id]/proof   — return latest proof row
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { createProof } from '@/lib/repos/fix-proofs.repo'

let testDb: ReturnType<typeof createTestDb>

// ─── DB mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// ─── Pipeline mocks (keep module import chain clean) ─────────────────────────
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

// ─── runTriad mock ────────────────────────────────────────────────────────────
const { mockRunTriad } = vi.hoisted(() => ({
  mockRunTriad: vi.fn(),
}))

vi.mock('@/lib/remediation/fix-and-prove/triad-runner', () => ({
  runTriad: mockRunTriad,
  TriadConflictError: class TriadConflictError extends Error {
    constructor(findingId: string) {
      super(`Triad already in-progress for finding ${findingId}`)
      this.name = 'TriadConflictError'
    }
  },
}))

import {
  POST as POSTVerify,
} from '@/app/api/findings/[id]/verify/route'
import { GET as GETProof } from '@/app/api/findings/[id]/proof/route'

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
    description: 'A vulnerability in src/db.ts',
    locationPath: overrides.locationPath ?? 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

// ─── POST /api/findings/[id]/verify ──────────────────────────────────────────

describe('POST /api/findings/[id]/verify', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 202 with proofId and status in-progress on success', async () => {
    const finding = makeFinding(testDb, scanId)

    // runTriad resolves after setImmediate — not called synchronously
    mockRunTriad.mockResolvedValue({
      proofId: 'proof-1',
      outcome: 'verified-fixed',
      failureReason: null,
    })

    const req = new Request(
      `http://localhost/api/findings/${finding.id}/verify`,
      { method: 'POST' },
    )
    const res = await POSTVerify(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('proofId')
    expect(typeof body.data.proofId).toBe('string')
    expect(body.data.status).toBe('in-progress')
  })

  it('returns 404 when the finding does not exist', async () => {
    const req = new Request(
      'http://localhost/api/findings/nonexistent/verify',
      { method: 'POST' },
    )
    const res = await POSTVerify(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 409 when a triad is already in-progress', async () => {
    const finding = makeFinding(testDb, scanId)

    // Create an in-progress proof row to simulate a concurrent run
    createProof(testDb, {
      findingId: finding.id,
      patchDiff: 'diff --git ...',
    })

    const req = new Request(
      `http://localhost/api/findings/${finding.id}/verify`,
      { method: 'POST' },
    )
    const res = await POSTVerify(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.code).toBe('CONFLICT')
  })
})

// ─── GET /api/findings/[id]/proof ────────────────────────────────────────────

describe('GET /api/findings/[id]/proof', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with the latest proof row for the finding', async () => {
    const finding = makeFinding(testDb, scanId)

    // Insert a proof directly via repo
    const proof = createProof(testDb, {
      findingId: finding.id,
      patchDiff: 'diff --git a/src/db.ts ...',
    })

    const req = new Request(
      `http://localhost/api/findings/${finding.id}/proof`,
    )
    const res = await GETProof(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(proof.id)
    expect(body.data.findingId).toBe(finding.id)
    expect(body.data.outcome).toBe('in-progress')
  })

  it('returns 404 when no proof exists for the finding', async () => {
    const finding = makeFinding(testDb, scanId)

    const req = new Request(
      `http://localhost/api/findings/${finding.id}/proof`,
    )
    const res = await GETProof(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 when the finding does not exist', async () => {
    const req = new Request(
      'http://localhost/api/findings/nonexistent/proof',
    )
    const res = await GETProof(req, makeContext('nonexistent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns the most recent proof when multiple exist', async () => {
    const finding = makeFinding(testDb, scanId)

    // Create two proofs — the second one is newer
    createProof(testDb, {
      findingId: finding.id,
      patchDiff: 'diff first',
      startedAt: '2024-01-01T00:00:00.000Z',
    })
    const newer = createProof(testDb, {
      findingId: finding.id,
      patchDiff: 'diff second',
      startedAt: '2024-01-02T00:00:00.000Z',
    })

    const req = new Request(
      `http://localhost/api/findings/${finding.id}/proof`,
    )
    const res = await GETProof(req, makeContext(finding.id))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.id).toBe(newer.id)
  })
})
