/**
 * tests/api/findings-fp-bank.test.ts
 *
 * Tests for GET /api/findings/fp-bank
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { createDismissal } from '@/lib/repos/finding-dismissals.repo'

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

import { GET as GETFpBank } from '@/app/api/findings/fp-bank/route'

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
    description: 'Test finding',
    locationPath: overrides.locationPath ?? 'src/db.ts',
    locationLineStart: 10,
    ...overrides,
  })
}

function makeDismissal(
  db: ReturnType<typeof createTestDb>,
  findingId: string,
  dedupKey: string,
  reason = 'This is a test false positive reason',
) {
  return createDismissal(db, {
    findingId,
    dedupKey,
    fpType: 'not_vulnerable',
    reason,
  })
}

describe('GET /api/findings/fp-bank', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = makeProject(testDb)
    const scan = makeScan(testDb, project.id)
    scanId = scan.id
  })

  it('returns 200 with empty list when no dismissals exist', async () => {
    const req = new Request('http://localhost/api/findings/fp-bank')
    const res = await GETFpBank(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.dismissals)).toBe(true)
    expect(body.data.dismissals).toHaveLength(0)
    expect(body.data.total).toBe(0)
  })

  it('returns all active dismissals', async () => {
    const f1 = makeFinding(testDb, scanId, { title: 'Finding A', locationPath: 'src/a.ts' })
    const f2 = makeFinding(testDb, scanId, { title: 'Finding B', locationPath: 'src/b.ts' })
    makeDismissal(testDb, f1.id, f1.dedupKey ?? f1.id, 'First dismissal reason text')
    makeDismissal(testDb, f2.id, f2.dedupKey ?? f2.id, 'Second dismissal reason text')

    const req = new Request('http://localhost/api/findings/fp-bank')
    const res = await GETFpBank(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.dismissals).toHaveLength(2)
    expect(body.data.total).toBe(2)
  })

  it('dismissal records contain expected fields', async () => {
    const f = makeFinding(testDb, scanId)
    makeDismissal(testDb, f.id, f.dedupKey ?? f.id, 'This is a test dismissal reason')

    const req = new Request('http://localhost/api/findings/fp-bank')
    const res = await GETFpBank(req)
    const body = await res.json()

    const dismissal = body.data.dismissals[0]
    expect(dismissal).toHaveProperty('id')
    expect(dismissal).toHaveProperty('findingId')
    expect(dismissal).toHaveProperty('fpType')
    expect(dismissal).toHaveProperty('reason')
    expect(dismissal).toHaveProperty('dismissedAt')
    expect(dismissal.fpType).toBe('not_vulnerable')
  })

  it('returns 400 for invalid limit param', async () => {
    const req = new Request('http://localhost/api/findings/fp-bank?limit=0')
    const res = await GETFpBank(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('respects limit param', async () => {
    // Create 5 dismissals
    for (let i = 0; i < 5; i++) {
      const f = makeFinding(testDb, scanId, {
        title: `Finding ${i}`,
        locationPath: `src/file${i}.ts`,
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
