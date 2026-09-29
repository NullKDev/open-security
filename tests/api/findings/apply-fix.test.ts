/**
 * tests/api/findings/apply-fix.test.ts
 *
 * TDD: T-E05 — apply-fix-to-pr route
 * Tests: 200 happy path, 409 merge conflict, 400 no patch, 424 no PR link
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

// ─── Mock db ─────────────────────────────────────────────────────────────────
let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// ─── Hoist mock functions ─────────────────────────────────────────────────────
const { mockApplyFix, mockGetFinding, mockGetScan, mockGetProject } = vi.hoisted(() => ({
  mockApplyFix: vi.fn(),
  mockGetFinding: vi.fn(),
  mockGetScan: vi.fn(),
  mockGetProject: vi.fn(),
}))

// ─── Mock the GitHub apply-fix helper ────────────────────────────────────────
vi.mock('@/lib/integrations/github/apply-fix', () => ({
  applyFixToPr: mockApplyFix,
}))

// ─── Mock findings repo ───────────────────────────────────────────────────────
vi.mock('@/lib/repos/findings.repo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/repos/findings.repo')>()
  return { ...mod, getFindingById: mockGetFinding }
})

// ─── Mock scans repo ─────────────────────────────────────────────────────────
vi.mock('@/lib/repos/scans.repo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/repos/scans.repo')>()
  return { ...mod, getScanById: mockGetScan }
})

// ─── Mock projects repo ───────────────────────────────────────────────────────
vi.mock('@/lib/repos/projects.repo', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/repos/projects.repo')>()
  return { ...mod, getProjectById: mockGetProject }
})

import { POST } from '@/app/api/findings/[id]/apply-fix-to-pr/route'

const FINDING_ID = 'finding-abc'
const SCAN_ID = 'scan-001'

function makeBaseFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    scanId: SCAN_ID,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: 'SQL Injection',
    description: 'Potential SQL injection',
    locationPath: 'src/db.ts',
    locationLineStart: 10,
    locationLineEnd: 12,
    patchDiff: '--- a/src/db.ts\n+++ b/src/db.ts\n@@ -10 +10 @@',
    patchExplanation: 'Use parameterized queries',
    patchGeneratedAt: '2024-01-01T00:00:00Z',
    dedupKey: 'dk-1',
    status: 'open',
    dismissedAt: null,
    dismissedBy: null,
    dismissedReason: null,
    ...overrides,
  }
}

function makeBaseScan(overrides: Record<string, unknown> = {}) {
  return {
    id: SCAN_ID,
    projectId: 'proj-1',
    strategy: 'diff',
    prNumber: 42,
    prCommentStatus: 'posted',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    ...overrides,
  }
}

function makeRequest(findingId: string) {
  return new Request(`http://localhost/api/findings/${findingId}/apply-fix-to-pr`, {
    method: 'POST',
  })
}

describe('POST /api/findings/[id]/apply-fix-to-pr', () => {
  beforeEach(() => {
    testDb = createTestDb(new Database(':memory:'))
    vi.clearAllMocks()
    // Default project mock — returns a project with parseable sourceRef
    mockGetProject.mockReturnValue({
      id: 'proj-1',
      name: 'test-repo',
      sourceKind: 'git',
      sourceRef: 'https://github.com/owner/repo',
      modelsConfig: null,
      createdAt: '2024-01-01T00:00:00Z',
    })
  })

  it('returns 400 when finding has no patch', async () => {
    mockGetFinding.mockReturnValue(makeBaseFinding({ patchDiff: null }))

    const res = await POST(makeRequest(FINDING_ID), {
      params: Promise.resolve({ id: FINDING_ID }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 409 when scan has no PR number', async () => {
    mockGetFinding.mockReturnValue(makeBaseFinding())
    mockGetScan.mockReturnValue(makeBaseScan({ prNumber: null }))

    const res = await POST(makeRequest(FINDING_ID), {
      params: Promise.resolve({ id: FINDING_ID }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
  })

  it('returns 200 on successful patch application', async () => {
    mockGetFinding.mockReturnValue(makeBaseFinding())
    mockGetScan.mockReturnValue(makeBaseScan())
    mockApplyFix.mockResolvedValue(undefined)

    const res = await POST(makeRequest(FINDING_ID), {
      params: Promise.resolve({ id: FINDING_ID }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockApplyFix).toHaveBeenCalledOnce()
  })

  it('returns 409 when applyFixToPr throws a merge conflict error', async () => {
    mockGetFinding.mockReturnValue(makeBaseFinding())
    mockGetScan.mockReturnValue(makeBaseScan())
    mockApplyFix.mockRejectedValue(new Error('409: Merge conflict detected'))

    const res = await POST(makeRequest(FINDING_ID), {
      params: Promise.resolve({ id: FINDING_ID }),
    })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
  })

  it('returns 404 when finding does not exist', async () => {
    mockGetFinding.mockReturnValue(undefined)

    const res = await POST(makeRequest('nonexistent'), {
      params: Promise.resolve({ id: 'nonexistent' }),
    })

    expect(res.status).toBe(404)
  })
})
