/**
 * tests/unit/remediation/triad-runner.test.ts
 *
 * TDD: T-020 (RED) + T-021 (GREEN) — triad-runner.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the triad-runner orchestrator which implements the Fix & Prove flow
 * (design.md §2.2 four-turn ACP sequence).
 *
 * Key behaviours tested:
 * 1. no-patch short-circuit → fix-unverified/no-patch (REQ-FP-07)
 * 2. baseline-red short-circuit → fix-unverified/unit-test-baseline-red
 * 3. 409 on concurrent POST for same finding (concurrency guard)
 * 4. worktree.removeWorktree called in finally (even on error)
 * 5. fix_proofs row written with correct outcome
 *
 * All external dependencies are mocked (worktree, git-ops, fix-proofs.repo,
 * findings.repo, scan-events.repo, test-runner, pr-comment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

// ─── Mocks declared BEFORE imports ────────────────────────────────────────

vi.mock('@/lib/remediation/fix-and-prove/worktree', () => ({
  proofWorktreePath: vi.fn((_proj: string, _scan: string, findingId: string) => `/tmp/proofs/${findingId}`),
  createWorktree: vi.fn().mockResolvedValue({ ok: true }),
  removeWorktree: vi.fn().mockResolvedValue({ ok: true }),
  applyPatch: vi.fn().mockResolvedValue({ ok: true }),
  revertPatch: vi.fn().mockResolvedValue({ ok: true }),
  pruneStale: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/remediation/test-runner', () => ({
  runTestCommand: vi.fn().mockResolvedValue({
    passed: true,
    output: 'All tests pass',
    exitCode: 0,
  }),
}))

vi.mock('@/lib/remediation/fix-and-prove/pr-comment', () => ({
  composePrComment: vi.fn().mockReturnValue('## ✅ Verified Fix\n...'),
}))

vi.mock('@/lib/remediation/fix-and-prove/regression-author', () => ({
  buildTurn3Prompt: vi.fn().mockReturnValue('Write a regression test for this vuln...'),
  resolveTestPath: vi.fn().mockReturnValue('/project/tests/__regression__/vuln.regression.test.ts'),
}))

// ─── Import after mocks ────────────────────────────────────────────────────

import {
  createWorktree,
  removeWorktree,
  applyPatch as applyPatchWorktree,
} from '@/lib/remediation/fix-and-prove/worktree'
import { runTestCommand } from '@/lib/remediation/test-runner'
import {
  runTriad,
  TriadConflictError,
} from '@/lib/remediation/fix-and-prove/triad-runner'

const mockCreateWorktree = vi.mocked(createWorktree)
const mockRemoveWorktree = vi.mocked(removeWorktree)
const mockApplyPatch = vi.mocked(applyPatchWorktree)
const mockRunTest = vi.mocked(runTestCommand)

// ─── Test helpers ──────────────────────────────────────────────────────────

function makeInput(scanId: string): CreateFindingInput {
  return {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: 'SQL Injection',
    locationPath: 'src/db.ts',
    locationLineStart: 10,
    patchDiff: 'diff --git a/src/db.ts b/src/db.ts\n+safe code',
  }
}

function makeInputNoPatch(scanId: string): CreateFindingInput {
  return {
    ...makeInput(scanId),
    patchDiff: null,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('runTriad', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string
  let scanId: string
  let srcDir: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    projectId = proj.id
    const scan = createScan(db, { projectId })
    scanId = scan.id
    srcDir = `/tmp/repos/${projectId}`
    vi.clearAllMocks()

    // Reset mocks to default (happy path)
    mockCreateWorktree.mockResolvedValue({ ok: true })
    mockRemoveWorktree.mockResolvedValue({ ok: true })
    mockApplyPatch.mockResolvedValue({ ok: true })
    mockRunTest.mockResolvedValue({ passed: true, output: 'All tests pass', exitCode: 0 })
  })

  // ─── no-patch short-circuit ──────────────────────────────────────────────

  describe('no-patch short-circuit (REQ-FP-07)', () => {
    it('returns fix-unverified/no-patch when finding has no patch_diff', async () => {
      const finding = insertFinding(db, makeInputNoPatch(scanId))

      const result = await runTriad(db, finding.id, srcDir)

      expect(result.outcome).toBe('fix-unverified')
      expect(result.failureReason).toBe('no-patch')
    })

    it('does NOT create a worktree when there is no patch', async () => {
      const finding = insertFinding(db, makeInputNoPatch(scanId))
      await runTriad(db, finding.id, srcDir)

      expect(mockCreateWorktree).not.toHaveBeenCalled()
    })

    it('writes a fix_proofs row even on no-patch short-circuit', async () => {
      const finding = insertFinding(db, makeInputNoPatch(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      expect(result.proofId).toBeTruthy()
    })
  })

  // ─── Baseline-red short-circuit ──────────────────────────────────────────

  describe('baseline-red short-circuit', () => {
    /** Seeds a project+scan that HAS a test_command so the baseline-red path is exercised */
    function seedWithTestCommand() {
      const projId = `proj-tc-${Math.random().toString(36).slice(2)}`
      db.$client
        .prepare(
          `INSERT INTO projects (id, name, source_kind, source_ref, created_at, test_command, tests_enabled)
           VALUES (?, 'Test', 'github', 'url', '2025-01-01T00:00:00Z', 'bun test', 1)`,
        )
        .run(projId)

      const sc = createScan(db, { projectId: projId })
      return { projId, scanId: sc.id }
    }

    it('returns fix-unverified/unit-test-baseline-red when unit tests fail', async () => {
      mockRunTest.mockResolvedValue({ passed: false, output: '2 failures', exitCode: 1 })
      const { scanId: localScanId } = seedWithTestCommand()
      const finding = insertFinding(db, makeInput(localScanId))

      const result = await runTriad(db, finding.id, srcDir)

      expect(result.outcome).toBe('fix-unverified')
      expect(result.failureReason).toBe('unit-test-baseline-red')
    })

    it('still removes the worktree on baseline-red (finally block)', async () => {
      mockRunTest.mockResolvedValue({ passed: false, output: 'fail', exitCode: 1 })
      const { scanId: localScanId } = seedWithTestCommand()
      const finding = insertFinding(db, makeInput(localScanId))

      await runTriad(db, finding.id, srcDir)

      expect(mockRemoveWorktree).toHaveBeenCalled()
    })
  })

  // ─── 409 concurrency guard ───────────────────────────────────────────────

  describe('409 on concurrent run', () => {
    it('throws TriadConflictError when a proof is already in-progress for the finding', async () => {
      const finding = insertFinding(db, makeInput(scanId))

      // Simulate first run creating an in-progress proof
      // by inserting directly into fix_proofs
      db.$client
        .prepare(
          `INSERT INTO fix_proofs (id, finding_id, patch_diff, outcome, started_at)
           VALUES (?, ?, ?, 'in-progress', ?)`,
        )
        .run('proof-existing', finding.id, 'diff', new Date().toISOString())

      await expect(runTriad(db, finding.id, srcDir)).rejects.toThrow(TriadConflictError)
    })

    it('TriadConflictError has a meaningful message', async () => {
      const finding = insertFinding(db, makeInput(scanId))

      db.$client
        .prepare(
          `INSERT INTO fix_proofs (id, finding_id, patch_diff, outcome, started_at)
           VALUES (?, ?, ?, 'in-progress', ?)`,
        )
        .run('proof-existing-2', finding.id, 'diff', new Date().toISOString())

      try {
        await runTriad(db, finding.id, srcDir)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(TriadConflictError)
        expect((err as TriadConflictError).message).toMatch(/in.progress|conflict/i)
      }
    })
  })

  // ─── Worktree cleanup in finally ─────────────────────────────────────────

  describe('worktree cleanup in finally block', () => {
    it('calls removeWorktree even when createWorktree fails', async () => {
      mockCreateWorktree.mockResolvedValue({ ok: false, error: 'git error' })
      const finding = insertFinding(db, makeInput(scanId))

      const result = await runTriad(db, finding.id, srcDir)

      // Worktree creation failed but remove is still called (best-effort)
      expect(result.outcome).toBe('fix-unverified')
      // removeWorktree called defensively
      expect(mockRemoveWorktree).toHaveBeenCalled()
    })

    it('calls removeWorktree when applyPatch fails', async () => {
      mockApplyPatch.mockResolvedValue({ ok: false, error: 'patch error' })
      const finding = insertFinding(db, makeInput(scanId))

      await runTriad(db, finding.id, srcDir)

      expect(mockRemoveWorktree).toHaveBeenCalled()
    })

    it('calls removeWorktree on the happy path', async () => {
      const finding = insertFinding(db, makeInput(scanId))
      await runTriad(db, finding.id, srcDir)

      expect(mockRemoveWorktree).toHaveBeenCalled()
    })
  })

  // ─── fix_proofs row written ───────────────────────────────────────────────

  describe('fix_proofs row management', () => {
    it('returns a proofId from the created row', async () => {
      const finding = insertFinding(db, makeInput(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      expect(result.proofId).toBeTruthy()
      expect(typeof result.proofId).toBe('string')
    })

    it('creates a proof row with outcome set', async () => {
      const finding = insertFinding(db, makeInput(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      const row = db.$client
        .prepare('SELECT * FROM fix_proofs WHERE id = ?')
        .get(result.proofId) as { outcome: string; failure_reason: string | null } | undefined

      expect(row).toBeTruthy()
      expect(row!.outcome).not.toBe('in-progress')
    })

    it('records the patch diff on the proof row', async () => {
      const finding = insertFinding(db, makeInput(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      const row = db.$client
        .prepare('SELECT * FROM fix_proofs WHERE id = ?')
        .get(result.proofId) as { patch_diff: string } | undefined

      expect(row!.patch_diff).toBeTruthy()
    })
  })

  // ─── Return shape ─────────────────────────────────────────────────────────

  describe('return value shape', () => {
    it('returns { proofId, outcome, failureReason } for no-patch', async () => {
      const finding = insertFinding(db, makeInputNoPatch(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      expect(result).toHaveProperty('proofId')
      expect(result).toHaveProperty('outcome')
      expect(result).toHaveProperty('failureReason')
    })

    it('returns outcome from the proof row on success', async () => {
      const finding = insertFinding(db, makeInput(scanId))
      const result = await runTriad(db, finding.id, srcDir)

      // With default mocks (tests pass) the outcome should be recorded
      expect(['verified-fixed', 'fix-unverified']).toContain(result.outcome)
    })
  })
})
