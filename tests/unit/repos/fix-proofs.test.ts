/**
 * tests/unit/repos/fix-proofs.test.ts
 *
 * TDD: T-003 (RED) + T-004 (GREEN) — fix-proofs.repo.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Covers: createProof, getLatestProof, markOutcome, sweepStaleInProgress
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import {
  createProof,
  getLatestProof,
  markOutcome,
  sweepStaleInProgress,
} from '@/lib/repos/fix-proofs.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

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

describe('fix-proofs.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(db, { projectId: proj.id })
    const finding = insertFinding(db, makeInput(scan.id))
    findingId = finding.id
  })

  describe('createProof', () => {
    it('inserts a row with outcome=in-progress and returns the DTO', () => {
      const proof = createProof(db, {
        findingId,
        patchDiff: 'diff text',
      })

      expect(proof.id).toBeTruthy()
      expect(proof.findingId).toBe(findingId)
      expect(proof.outcome).toBe('in-progress')
      expect(proof.completedAt).toBeNull()
      expect(proof.startedAt).toBeTruthy()
    })

    it('stores patchDiff on the row', () => {
      const proof = createProof(db, {
        findingId,
        patchDiff: 'my-patch-diff-content',
      })
      expect(proof.patchDiff).toBe('my-patch-diff-content')
    })

    it('stores optional acpSessionId', () => {
      // branchId references finding_branches which requires a real row — skip FK here.
      // The branchId FK is tested via integration; this test focuses on acpSessionId.
      const proof = createProof(db, {
        findingId,
        patchDiff: 'diff',
        acpSessionId: 'session-456',
      })
      expect(proof.acpSessionId).toBe('session-456')
    })

    it('allows multiple proofs for the same finding', () => {
      const p1 = createProof(db, { findingId, patchDiff: 'diff1' })
      const p2 = createProof(db, { findingId, patchDiff: 'diff2' })
      expect(p1.id).not.toBe(p2.id)
    })
  })

  describe('getLatestProof', () => {
    it('returns null when no proof exists for the finding', () => {
      const result = getLatestProof(db, findingId)
      expect(result).toBeNull()
    })

    it('returns the most recently started proof (by explicit timestamps)', () => {
      const earlier = new Date(Date.now() - 10000).toISOString()
      const later = new Date(Date.now()).toISOString()

      createProof(db, { findingId, patchDiff: 'diff1', startedAt: earlier })
      const p2 = createProof(db, { findingId, patchDiff: 'diff2', startedAt: later })

      const latest = getLatestProof(db, findingId)
      expect(latest).not.toBeNull()
      expect(latest!.id).toBe(p2.id)
    })

    it('returns the single existing proof', () => {
      const p = createProof(db, { findingId, patchDiff: 'diff' })
      const latest = getLatestProof(db, findingId)
      expect(latest!.id).toBe(p.id)
    })
  })

  describe('markOutcome', () => {
    it('updates outcome and completedAt on the proof row', () => {
      const proof = createProof(db, { findingId, patchDiff: 'diff' })
      const updated = markOutcome(db, proof.id, {
        outcome: 'verified-fixed',
        unitTestPassed: true,
        vulRunPassedPre: false,
        vulRunPassedPost: true,
      })

      expect(updated.outcome).toBe('verified-fixed')
      expect(updated.completedAt).toBeTruthy()
      expect(updated.unitTestPassed).toBe(true)
      expect(updated.vulRunPassedPre).toBe(false)
      expect(updated.vulRunPassedPost).toBe(true)
    })

    it('sets failureReason when outcome is fix-unverified', () => {
      const proof = createProof(db, { findingId, patchDiff: 'diff' })
      const updated = markOutcome(db, proof.id, {
        outcome: 'fix-unverified',
        failureReason: 'no-patch',
      })

      expect(updated.outcome).toBe('fix-unverified')
      expect(updated.failureReason).toBe('no-patch')
    })

    it('stores terminal outputs', () => {
      const proof = createProof(db, { findingId, patchDiff: 'diff' })
      const updated = markOutcome(db, proof.id, {
        outcome: 'fix-unverified',
        failureReason: 'unit-test-baseline-red',
        prePatchOutput: 'pre output',
        postPatchOutput: 'post output',
        unitTestOutput: 'test output',
      })

      expect(updated.prePatchOutput).toBe('pre output')
      expect(updated.postPatchOutput).toBe('post output')
      expect(updated.unitTestOutput).toBe('test output')
    })

    it('stores regressionTestPath and regressionTestDiff', () => {
      const proof = createProof(db, { findingId, patchDiff: 'diff' })
      const updated = markOutcome(db, proof.id, {
        outcome: 'verified-fixed',
        regressionTestPath: 'tests/__regression__/db.regression.test.ts',
        regressionTestDiff: 'diff of regression test',
      })

      expect(updated.regressionTestPath).toBe('tests/__regression__/db.regression.test.ts')
      expect(updated.regressionTestDiff).toBe('diff of regression test')
    })
  })

  describe('sweepStaleInProgress', () => {
    it('returns 0 when no stale proofs exist', () => {
      const count = sweepStaleInProgress(db, 3600)
      expect(count).toBe(0)
    })

    it('marks in-progress proofs older than cutoff as fix-unverified/agent-error', () => {
      // Insert a proof with a very old startedAt
      const pastTs = new Date(Date.now() - 7200 * 1000).toISOString() // 2 hours ago
      const proof = createProof(db, { findingId, patchDiff: 'diff', startedAt: pastTs })

      const count = sweepStaleInProgress(db, 3600) // 1-hour cutoff
      expect(count).toBe(1)

      const updated = getLatestProof(db, findingId)
      expect(updated!.outcome).toBe('fix-unverified')
      expect(updated!.failureReason).toBe('agent-error')
    })

    it('does not sweep in-progress proofs younger than cutoff', () => {
      const recentTs = new Date(Date.now() - 60 * 1000).toISOString() // 1 minute ago
      createProof(db, { findingId, patchDiff: 'diff', startedAt: recentTs })

      const count = sweepStaleInProgress(db, 3600)
      expect(count).toBe(0)

      const latest = getLatestProof(db, findingId)
      expect(latest!.outcome).toBe('in-progress')
    })

    it('does not sweep already-completed proofs', () => {
      const pastTs = new Date(Date.now() - 7200 * 1000).toISOString()
      const proof = createProof(db, { findingId, patchDiff: 'diff', startedAt: pastTs })
      markOutcome(db, proof.id, { outcome: 'verified-fixed' })

      const count = sweepStaleInProgress(db, 3600)
      expect(count).toBe(0)
    })
  })
})
