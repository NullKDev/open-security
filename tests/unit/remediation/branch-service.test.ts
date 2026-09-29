/**
 * tests/unit/remediation/branch-service.test.ts
 *
 * TDD: T-D05 — branch service state machine
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the branch service which orchestrates the full branch creation flow:
 * pending → creating → apply_failed | tests_running → tests_failed | created
 *
 * Uses in-memory DB + mocked git-ops and test-runner modules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createBranchRecord, getBranchByFindingId } from '@/lib/repos/finding-branches.repo'
import { createFixBranch } from '@/lib/remediation/branch-service'

// Mock git-ops and test-runner at module level
vi.mock('@/lib/remediation/git-ops', () => ({
  buildBranchName: vi.fn((id: string) => `sec/fix/${id.slice(0, 8)}`),
  resolveHeadCommit: vi.fn().mockResolvedValue('deadbeef123'),
  checkoutBranch: vi.fn().mockResolvedValue({ ok: true }),
  applyPatch: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/remediation/test-runner', () => ({
  runTestCommand: vi.fn().mockResolvedValue({ passed: true, output: 'All tests pass', exitCode: 0 }),
}))

import { checkoutBranch, applyPatch, resolveHeadCommit } from '@/lib/remediation/git-ops'
import { runTestCommand } from '@/lib/remediation/test-runner'

const mockCheckoutBranch = vi.mocked(checkoutBranch)
const mockApplyPatch = vi.mocked(applyPatch)
const mockResolveHead = vi.mocked(resolveHeadCommit)
const mockRunTest = vi.mocked(runTestCommand)

/** Seed a project, scan, and finding into the test DB */
function seedData(
  db: ReturnType<typeof createTestDb>,
  opts: {
    projectId?: string
    scanId?: string
    findingId?: string
    patchDiff?: string | null
    testCommand?: string | null
    testsEnabled?: number
  } = {},
) {
  const {
    projectId = 'proj-1',
    scanId = 'scan-1',
    findingId = 'finding-1111-2222-3333-4444',
    patchDiff = 'diff --git a/file.ts b/file.ts\n+// fix',
    testCommand = null,
    testsEnabled = 0,
  } = opts

  db.$client.prepare(`
    INSERT INTO projects (id, name, source_kind, source_ref, created_at, test_command, tests_enabled)
    VALUES (?, 'Project', 'local', '/tmp/repo', '2025-01-01T00:00:00Z', ?, ?)
  `).run(projectId, testCommand, testsEnabled)

  db.$client.prepare(`
    INSERT INTO scans (id, project_id, status)
    VALUES (?, ?, 'done')
  `).run(scanId, projectId)

  db.$client.prepare(`
    INSERT INTO findings (id, scan_id, detector, severity, confidence, exploitability,
      title, description, location_path, location_line_start, created_at, patch_diff)
    VALUES (?, ?, 'semgrep', 'HIGH', 0.9, 0.7, 'SQL Injection', '', '/file.ts', 1,
      '2025-01-01T00:00:00Z', ?)
  `).run(findingId, scanId, patchDiff)

  return { projectId, scanId, findingId }
}

describe('createFixBranch', () => {
  let db: ReturnType<typeof createTestDb>
  let tmpDir: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-svc-test-'))
    vi.resetAllMocks()

    // Reset default mock implementations
    mockCheckoutBranch.mockResolvedValue({ ok: true })
    mockApplyPatch.mockResolvedValue({ ok: true })
    mockResolveHead.mockResolvedValue('deadbeef123')
    mockRunTest.mockResolvedValue({ passed: true, output: 'All tests pass', exitCode: 0 })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('transitions to created status when checkout + apply succeed (no tests)', async () => {
    const { findingId } = seedData(db, { testsEnabled: 0 })
    const branch = createBranchRecord(db, findingId)

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('created')
    expect(updated?.branchRef).toMatch(/^sec\/fix\//)
  })

  it('transitions to apply_failed when checkout fails', async () => {
    const { findingId } = seedData(db)
    const branch = createBranchRecord(db, findingId)

    mockCheckoutBranch.mockResolvedValue({ ok: false, error: 'branch already exists' })

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('apply_failed')
    expect(updated?.applyError).toContain('branch already exists')
  })

  it('transitions to apply_failed when git apply fails', async () => {
    const { findingId } = seedData(db)
    const branch = createBranchRecord(db, findingId)

    mockApplyPatch.mockResolvedValue({ ok: false, error: 'patch does not apply' })

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('apply_failed')
    expect(updated?.applyError).toContain('patch does not apply')
  })

  it('runs tests and sets created when testsEnabled=1 and tests pass', async () => {
    const { findingId } = seedData(db, {
      testCommand: 'npm test',
      testsEnabled: 1,
    })
    const branch = createBranchRecord(db, findingId)

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('created')
    expect(updated?.testsPassed).toBe(1)
    expect(updated?.testsOutput).toContain('All tests pass')
    expect(mockRunTest).toHaveBeenCalledWith(expect.any(String), 'npm test')
  })

  it('transitions to tests_failed when tests run but fail', async () => {
    const { findingId } = seedData(db, {
      testCommand: 'npm test',
      testsEnabled: 1,
    })
    const branch = createBranchRecord(db, findingId)

    mockRunTest.mockResolvedValue({ passed: false, output: '2 tests failed', exitCode: 1 })

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('tests_failed')
    expect(updated?.testsPassed).toBe(0)
    expect(updated?.testsOutput).toContain('2 tests failed')
  })

  it('sets apply_failed when finding has no patch_diff', async () => {
    const { findingId } = seedData(db, { patchDiff: null })
    const branch = createBranchRecord(db, findingId)

    await createFixBranch(db, branch.id, tmpDir)

    const updated = getBranchByFindingId(db, findingId)
    expect(updated?.status).toBe('apply_failed')
    expect(updated?.applyError).toContain('no patch_diff')
  })
})
