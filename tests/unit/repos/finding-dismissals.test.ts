/**
 * tests/unit/repos/finding-dismissals.test.ts
 *
 * TDD: T-B06 — Finding dismissals repo
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import {
  createDismissal,
  isDismissed,
  undoDismissal,
  listActiveDismissals,
} from '@/lib/repos/finding-dismissals.repo'
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
  }
}

describe('finding-dismissals.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string
  let dedupKey: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(db, { projectId: proj.id })
    const finding = insertFinding(db, makeInput(scan.id))
    findingId = finding.id
    dedupKey = finding.dedupKey!
  })

  describe('createDismissal', () => {
    it('inserts a dismissal row with undone_at = null', () => {
      const dismissal = createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'false_positive',
        reason: 'This is only in test fixtures and never reaches production',
      })

      expect(dismissal.id).toBeTruthy()
      expect(dismissal.undoneAt).toBeNull()
      expect(dismissal.fpType).toBe('false_positive')
    })

    it('stores the reason and dedup_key on the row', () => {
      const dismissal = createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'acceptable_risk',
        reason: 'Risk accepted by security team after review',
      })

      expect(dismissal.reason).toBe('Risk accepted by security team after review')
      expect(dismissal.dedupKey).toBe(dedupKey)
    })

    it('supports all fp_type values', () => {
      const types = ['false_positive', 'acceptable_risk', 'wont_fix', 'duplicate'] as const
      for (const fpType of types) {
        const proj2 = createProject(db, { name: 'p', sourceKind: 'github', sourceRef: 'url' })
        const scan2 = createScan(db, { projectId: proj2.id })
        const f2 = insertFinding(db, { ...makeInput(scan2.id), title: `Finding for ${fpType}`, locationPath: `src/${fpType}.ts` })
        const d = createDismissal(db, {
          findingId: f2.id,
          dedupKey: f2.dedupKey!,
          fpType,
          reason: 'Valid reason longer than ten chars',
        })
        expect(d.fpType).toBe(fpType)
      }
    })
  })

  describe('isDismissed', () => {
    it('returns true when an active dismissal exists for the dedup_key', () => {
      createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'false_positive',
        reason: 'Active dismissal reason for testing',
      })

      expect(isDismissed(db, dedupKey)).toBe(true)
    })

    it('returns false for a dedup_key with no dismissal', () => {
      expect(isDismissed(db, 'nonexistent-dedup-key')).toBe(false)
    })

    it('returns false when the only dismissal has been undone', () => {
      const dismissal = createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'false_positive',
        reason: 'Undo me after this test assertion',
      })

      undoDismissal(db, dismissal.id)
      expect(isDismissed(db, dedupKey)).toBe(false)
    })
  })

  describe('undoDismissal', () => {
    it('sets undone_at to a non-null timestamp', () => {
      const dismissal = createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'wont_fix',
        reason: 'Wont fix for now due to low risk score',
      })

      const updated = undoDismissal(db, dismissal.id)
      expect(updated.undoneAt).toBeTruthy()
    })

    it('undone dismissal is no longer active — isDismissed returns false', () => {
      const dismissal = createDismissal(db, {
        findingId,
        dedupKey,
        fpType: 'false_positive',
        reason: 'False positive in integration test harness only',
      })

      undoDismissal(db, dismissal.id)
      expect(isDismissed(db, dedupKey)).toBe(false)
    })
  })

  describe('listActiveDismissals', () => {
    it('returns only active dismissals (undone_at IS NULL)', () => {
      const d1 = createDismissal(db, { findingId, dedupKey, fpType: 'false_positive', reason: 'First active dismissal reason here' })

      const proj2 = createProject(db, { name: 'p2', sourceKind: 'github', sourceRef: 'url' })
      const scan2 = createScan(db, { projectId: proj2.id })
      const f2 = insertFinding(db, { ...makeInput(scan2.id), title: 'XSS in profile', locationPath: 'src/xss.ts' })
      const d2 = createDismissal(db, { findingId: f2.id, dedupKey: f2.dedupKey!, fpType: 'acceptable_risk', reason: 'Second active dismissal reason here' })

      // Undo d2
      undoDismissal(db, d2.id)

      const active = listActiveDismissals(db)
      const ids = active.map((d) => d.id)
      expect(ids).toContain(d1.id)
      expect(ids).not.toContain(d2.id)
    })

    it('returns empty array when no active dismissals', () => {
      const active = listActiveDismissals(db)
      expect(active).toHaveLength(0)
    })
  })
})
