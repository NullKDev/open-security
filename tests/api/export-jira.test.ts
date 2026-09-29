/**
 * tests/api/export-jira.test.ts
 *
 * TDD RED → GREEN: T-038 — POST /api/findings/[id]/export/jira
 *
 * Covers:
 * - Success: returns {ok, jiraKey}
 * - Finding not found → 404
 * - Missing Jira credentials → 500
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

import { POST } from '@/app/api/findings/[id]/export/jira/route'

interface RouteContext {
  params: Promise<{ id: string }>
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/findings/[id]/export/jira', () => {
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    // Clear Jira env
    delete process.env.OBT_JIRA_BASE_URL
    delete process.env.OBT_JIRA_PROJECT_KEY
    delete process.env.OBT_JIRA_EMAIL
    delete process.env.OBT_JIRA_API_TOKEN

    const project = createProject(testDb, { name: 'proj', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(testDb, { projectId: project.id })
    const finding = insertFinding(testDb, {
      scanId: scan.id,
      detector: 'gitleaks',
      severity: 'high',
      confidence: 0.9,
      title: 'Hardcoded key',
      description: 'Found in config.ts',
      locationPath: 'config.ts',
      locationLineStart: 10,
    })
    findingId = finding.id
  })

  it('returns 200 with jiraKey on success', async () => {
    process.env.OBT_JIRA_BASE_URL = 'https://test.atlassian.net'
    process.env.OBT_JIRA_PROJECT_KEY = 'SEC'
    process.env.OBT_JIRA_EMAIL = 'user@example.com'
    process.env.OBT_JIRA_API_TOKEN = 'token-abc'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ key: 'SEC-42' }),
    }))

    const req = new Request(`http://localhost/api/findings/${findingId}/export/jira`, { method: 'POST' })
    const res = await POST(req, makeContext(findingId))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.ok).toBe(true)
    expect(body.data.jiraKey).toBe('SEC-42')

    vi.unstubAllGlobals()
  })

  it('returns 404 when finding does not exist', async () => {
    const req = new Request('http://localhost/api/findings/nonexistent/export/jira', { method: 'POST' })
    const res = await POST(req, makeContext('nonexistent'))

    expect(res.status).toBe(404)
  })

  it('returns 500 when Jira credentials are missing', async () => {
    const req = new Request(`http://localhost/api/findings/${findingId}/export/jira`, { method: 'POST' })
    const res = await POST(req, makeContext(findingId))

    expect(res.status).toBe(500)
  })
})
