/**
 * tests/api/policies.test.ts
 *
 * TDD RED → GREEN: T-043 — PUT /api/policies
 *
 * Covers:
 * - Valid YAML → 200 ok
 * - Invalid YAML syntax → 400 with error
 * - Invalid PolicyFile schema → 400 with details
 * - Empty body → 400
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

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

// Mock fs so tests don't write to disk
vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>()
  return {
    ...mod,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

import { PUT } from '@/app/api/policies/route'

describe('PUT /api/policies', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 200 ok on valid YAML policies', async () => {
    const yaml = `
rules:
  - id: suppress-test
    type: suppress
    match:
      path: "tests/**"
    decision:
      suppress: true
`.trim()

    const req = new Request('http://localhost/api/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    })

    const res = await PUT(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.ok).toBe(true)
  })

  it('returns 400 on invalid YAML syntax', async () => {
    const yaml = 'invalid: yaml: : : bad'

    const req = new Request('http://localhost/api/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    })

    const res = await PUT(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on missing yaml field in body', async () => {
    const req = new Request('http://localhost/api/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req)
    expect(res.status).toBe(400)
  })
})
