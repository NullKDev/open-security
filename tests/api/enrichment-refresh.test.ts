/**
 * tests/api/enrichment-refresh.test.ts
 *
 * Tests for POST /api/enrichment/refresh
 *
 * Strict TDD: RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

let testDb: ReturnType<typeof createTestDb>

const mockEnrichScan = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRefreshKevCatalog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

vi.mock('@/lib/enrichment/service', () => ({
  enrichScan: mockEnrichScan,
}))

vi.mock('@/lib/enrichment/kev', () => ({
  refreshKevCatalog: mockRefreshKevCatalog,
}))

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

import { POST as POSTRefresh } from '@/app/api/enrichment/refresh/route'

describe('POST /api/enrichment/refresh', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 200 on success', async () => {
    const req = new Request('http://localhost/api/enrichment/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTRefresh(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('calls refreshKevCatalog', async () => {
    const req = new Request('http://localhost/api/enrichment/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    await POSTRefresh(req)

    expect(mockRefreshKevCatalog).toHaveBeenCalledTimes(1)
  })

  it('accepts empty body (no required fields)', async () => {
    const req = new Request('http://localhost/api/enrichment/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTRefresh(req)

    expect(res.status).toBe(200)
  })

  it('accepts force=true body', async () => {
    const req = new Request('http://localhost/api/enrichment/refresh', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTRefresh(req)

    expect(res.status).toBe(200)
  })

  it('returns 200 even if refreshKevCatalog throws (graceful degradation)', async () => {
    mockRefreshKevCatalog.mockRejectedValueOnce(new Error('network error'))

    const req = new Request('http://localhost/api/enrichment/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POSTRefresh(req)

    expect(res.status).toBe(200)
  })
})
