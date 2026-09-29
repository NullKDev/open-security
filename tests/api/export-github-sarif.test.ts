/**
 * tests/api/export-github-sarif.test.ts
 *
 * TDD RED → GREEN: T-039 — POST /api/scans/[id]/export/github-sarif
 *
 * Covers:
 * - Success: returns {ok, uploadId}
 * - Scan not found → 404
 * - Missing GitHub credentials → 500
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { POST } from '@/app/api/scans/[id]/export/github-sarif/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/scans/[id]/export/github-sarif', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    delete process.env.OBT_GITHUB_PAT
    delete process.env.OBT_GITHUB_OWNER
    delete process.env.OBT_GITHUB_REPO

    const project = createProject(testDb, { name: 'proj', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id

    insertFinding(testDb, {
      scanId,
      detector: 'semgrep',
      severity: 'high',
      confidence: 0.9,
      title: 'SQL Injection',
      description: 'Parameterize queries',
      locationPath: 'src/db.ts',
      locationLineStart: 5,
    })
  })

  it('returns 200 with uploadId on success', async () => {
    process.env.OBT_GITHUB_PAT = 'ghp_test'
    process.env.OBT_GITHUB_OWNER = 'test-owner'
    process.env.OBT_GITHUB_REPO = 'test-repo'

    vi.useFakeTimers()

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ id: 'upload-abc', url: 'https://api.github.com/repos/test-owner/test-repo/code-scanning/sarifs/upload-abc' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ processing_status: 'complete' }),
      })
    )

    const req = new Request(`http://localhost/api/scans/${scanId}/export/github-sarif`, { method: 'POST' })
    const promise = POST(req, makeContext(scanId))
    await vi.runAllTimersAsync()
    const res = await promise
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.ok).toBe(true)
    expect(body.data.uploadId).toBeTruthy()

    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns 404 when scan does not exist', async () => {
    const req = new Request('http://localhost/api/scans/nonexistent/export/github-sarif', { method: 'POST' })
    const res = await POST(req, makeContext('nonexistent'))

    expect(res.status).toBe(404)
  })

  it('returns 500 when GitHub credentials are missing', async () => {
    const req = new Request(`http://localhost/api/scans/${scanId}/export/github-sarif`, { method: 'POST' })
    const res = await POST(req, makeContext(scanId))

    expect(res.status).toBe(500)
  })
})
