/**
 * tests/api/scans/hunt.test.ts
 *
 * TDD: T-045 (RED) → T-046 (GREEN)
 * Tests for POST /api/scans/hunt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock DB and pipeline — we test route logic, not DB/pipeline internals
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@/lib/repos/scans.repo', () => ({
  createScan: vi.fn(() => ({ id: 'scan-hunt-001', status: 'pending', version: 1 })),
}))

vi.mock('@/lib/repos/projects.repo', () => ({
  createProject: vi.fn(() => ({ id: 'proj-001' })),
}))

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({
    abort: vi.fn(),
    done: Promise.resolve(),
  })),
}))

vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: {},
}))

vi.mock('@/lib/config/workspace', () => ({
  scanDir: vi.fn(() => '/tmp/scan-dir'),
}))

vi.mock('@/lib/config/store', () => ({
  readConfig: vi.fn(() => ({ models: {} })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let POST: (req: Request) => Promise<Response>

describe('POST /api/scans/hunt', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('@/app/api/scans/hunt/route')
    POST = mod.POST
  })

  // -----------------------------------------------------------------------
  // 202 — valid request
  // -----------------------------------------------------------------------
  it('returns 202 with scanId for valid CVE-YYYY-NNNN format', async () => {
    const req = makeRequest({ cveId: 'CVE-2024-1234', targetPath: '/some/path' })
    const response = await POST(req)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toHaveProperty('scanId')
    expect(typeof body.scanId).toBe('string')
  })

  it('returns 202 with scanId for GHSA-* format', async () => {
    const req = makeRequest({ cveId: 'GHSA-1234-5678-abcd', targetPath: '/repo' })
    const response = await POST(req)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toHaveProperty('scanId')
  })

  // -----------------------------------------------------------------------
  // 400 — invalid CVE format
  // -----------------------------------------------------------------------
  it('returns 400 for invalid CVE format', async () => {
    const req = makeRequest({ cveId: 'NOT-A-CVE', targetPath: '/some/path' })
    const response = await POST(req)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for CVE with invalid year (not numeric)', async () => {
    const req = makeRequest({ cveId: 'CVE-ABCD-1234', targetPath: '/some/path' })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  // -----------------------------------------------------------------------
  // 400 — missing targetPath
  // -----------------------------------------------------------------------
  it('returns 400 when targetPath is missing', async () => {
    const req = makeRequest({ cveId: 'CVE-2024-1234' })
    const response = await POST(req)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when targetPath is empty string', async () => {
    const req = makeRequest({ cveId: 'CVE-2024-1234', targetPath: '' })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  // -----------------------------------------------------------------------
  // 400 — missing cveId
  // -----------------------------------------------------------------------
  it('returns 400 when cveId is missing', async () => {
    const req = makeRequest({ targetPath: '/some/path' })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  // -----------------------------------------------------------------------
  // 400 — invalid JSON
  // -----------------------------------------------------------------------
  it('returns 400 for invalid JSON body', async () => {
    const req = {
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Request
    const response = await POST(req)

    expect(response.status).toBe(400)
  })
})
