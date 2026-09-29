/**
 * tests/api/repos/scan.test.ts
 *
 * TDD: T-G01 — POST /api/repos/[id]/scan
 * Tests: diff scan trigger with prNumber/baseSha/headSha,
 *        missing repo returns 404, invalid body returns 400,
 *        standard scan (mode fallback) creates scan correctly.
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

// ─── Hoist mock functions ─────────────────────────────────────────────────────
const { mockGetRepo, mockGetMostRecent, mockCreateScan, mockRunPipeline } = vi.hoisted(() => ({
  mockGetRepo: vi.fn(),
  mockGetMostRecent: vi.fn(),
  mockCreateScan: vi.fn(),
  mockRunPipeline: vi.fn(),
}))

// ─── Mock db ─────────────────────────────────────────────────────────────────
let testDb: ReturnType<typeof createTestDb>
vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// ─── Mock repos repo ─────────────────────────────────────────────────────────
vi.mock('@/lib/repos/repos.repo', () => ({
  getRepoById: mockGetRepo,
}))

// ─── Mock scans repo ─────────────────────────────────────────────────────────
vi.mock('@/lib/repos/scans.repo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/repos/scans.repo')>()
  return {
    ...mod,
    createScan: mockCreateScan,
    getMostRecentCompletedScan: mockGetMostRecent,
  }
})

// ─── Mock pipeline runner ────────────────────────────────────────────────────
vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: mockRunPipeline,
}))

// ─── Mock shared bus ─────────────────────────────────────────────────────────
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { publish: vi.fn(), destroy: vi.fn() },
}))

// ─── Mock workspace ──────────────────────────────────────────────────────────
vi.mock('@/lib/config/workspace', () => ({
  scanDir: vi.fn(() => '/tmp/test-scan-dir'),
}))

import { POST } from '@/app/api/repos/[id]/scan/route'

const REPO_ID = 'repo-abc'
const PROJECT_ID = 'proj-xyz'

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: REPO_ID,
    projectId: PROJECT_ID,
    name: 'my-repo',
    localPath: '/home/user/my-repo',
    defaultBranch: 'main',
    watchEnabled: false,
    watchInterval: '0 */6 * * *',
    notifyChannels: '[]',
    notifySeverityFloor: 'high',
    slackWebhookUrlRef: null,
    webhookSecretRef: null,
    webhookProxyUrl: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeScan(id: string = 'scan-001') {
  return {
    id,
    projectId: PROJECT_ID,
    parentId: null,
    version: 1,
    prompt: null,
    scanMode: 'standard',
    strategy: 'diff',
    baseSha: null,
    headSha: null,
    prNumber: null,
    prCommentStatus: null,
    status: 'pending',
    stage: null,
    startedAt: null,
    finishedAt: null,
    modelsUsed: null,
    error: null,
    projectMap: null,
  }
}

function makeRequest(repoId: string, body: unknown) {
  return new Request(`http://localhost/api/repos/${repoId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/repos/[id]/scan', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
    vi.clearAllMocks()
    // Default: pipeline handle
    mockRunPipeline.mockReturnValue({ done: Promise.resolve(), abort: vi.fn() })
  })

  it('returns 404 when repo does not exist', async () => {
    mockGetRepo.mockReturnValue(undefined)

    const res = await POST(
      makeRequest(REPO_ID, { mode: 'standard' }),
      { params: Promise.resolve({ id: REPO_ID }) },
    )

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 400 on invalid request body', async () => {
    mockGetRepo.mockReturnValue(makeRepo())

    const res = await POST(
      makeRequest(REPO_ID, { mode: 'diff' /* missing prNumber/baseSha/headSha */ }),
      { params: Promise.resolve({ id: REPO_ID }) },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('creates a diff scan with prNumber, baseSha, headSha', async () => {
    mockGetRepo.mockReturnValue(makeRepo())
    mockGetMostRecent.mockReturnValue(null)
    mockCreateScan.mockReturnValue(makeScan('diff-scan-1'))

    const res = await POST(
      makeRequest(REPO_ID, {
        mode: 'diff',
        prNumber: 42,
        baseSha: 'abc123',
        headSha: 'def456',
      }),
      { params: Promise.resolve({ id: REPO_ID }) },
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.id).toBe('diff-scan-1')

    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: PROJECT_ID,
        strategy: 'diff',
        prNumber: 42,
        baseSha: 'abc123',
        headSha: 'def456',
      }),
    )
  })

  it('creates a standard scan when mode is omitted', async () => {
    mockGetRepo.mockReturnValue(makeRepo())
    mockGetMostRecent.mockReturnValue(null)
    mockCreateScan.mockReturnValue(makeScan('std-scan-1'))

    const res = await POST(
      makeRequest(REPO_ID, {}),
      { params: Promise.resolve({ id: REPO_ID }) },
    )

    expect(res.status).toBe(201)
    expect(mockCreateScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ strategy: 'standard' }),
    )
  })

  it('runs the pipeline after creating the scan', async () => {
    mockGetRepo.mockReturnValue(makeRepo())
    mockGetMostRecent.mockReturnValue(null)
    mockCreateScan.mockReturnValue(makeScan('scan-run-1'))

    await POST(
      makeRequest(REPO_ID, { mode: 'standard' }),
      { params: Promise.resolve({ id: REPO_ID }) },
    )

    expect(mockRunPipeline).toHaveBeenCalledOnce()
    const pipelineArgs = mockRunPipeline.mock.calls[0][0]
    expect(pipelineArgs.scanId).toBe('scan-run-1')
    expect(pipelineArgs.sourceRef).toBe('/home/user/my-repo')
  })
})
