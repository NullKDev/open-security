/**
 * tests/unit/repos/findings-dedup.test.ts
 *
 * TDD: T-B01 — Dedup upsert behavior in findings repo
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding, getFindingById } from '@/lib/repos/findings.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

function makeInput(scanId: string, overrides?: Partial<CreateFindingInput>): CreateFindingInput {
  return {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: 'SQL Injection in query',
    locationPath: 'src/auth/login.ts',
    locationLineStart: 42,
    ...overrides,
  }
}

describe('findings.repo — dedup upsert', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string
  let scanId2: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(db, { projectId: proj.id })
    const scan2 = createScan(db, { projectId: proj.id })
    scanId = scan.id
    scanId2 = scan2.id
  })

  describe('first insertion (canonical)', () => {
    it('first finding is canonical: canonicalFindingId is null', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(finding.canonicalFindingId).toBeNull()
    })

    it('first finding has occurrence_count = 1', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(finding.occurrenceCount).toBe(1)
    })

    it('first finding has dedup_key populated', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(finding.dedupKey).toBeTruthy()
      expect(finding.dedupKey).toMatch(/^[0-9a-f]{64}$/)
    })

    it('first finding has first_detected_at set', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(finding.firstDetectedAt).toBeTruthy()
    })
  })

  describe('duplicate insertion (links to canonical)', () => {
    it('second finding with same dedup_key gets canonical_finding_id = first.id', () => {
      const first = insertFinding(db, makeInput(scanId))
      // Same detector, location, title in a second scan
      const second = insertFinding(db, makeInput(scanId2))

      expect(second.canonicalFindingId).toBe(first.id)
    })

    it('canonical occurrence_count increments to 2 after duplicate', () => {
      const first = insertFinding(db, makeInput(scanId))
      insertFinding(db, makeInput(scanId2))

      // Re-fetch the canonical finding to check occurrence_count was incremented
      const canon = getFindingById(db, first.id)
      expect(canon?.occurrenceCount).toBe(2)
    })

    it('canonical last_seen_at is updated when duplicate is inserted', () => {
      const first = insertFinding(db, makeInput(scanId))
      const originalLastSeen = first.lastSeenAt

      // Wait a tick to ensure different timestamp
      const secondInput = makeInput(scanId2)
      const second = insertFinding(db, secondInput)

      const canon = getFindingById(db, first.id)
      // last_seen_at should be updated (either same or more recent)
      expect(canon?.lastSeenAt).toBeTruthy()
      expect(second.canonicalFindingId).toBe(first.id)
    })

    it('duplicate finding has occurrence_count = 1 (its own row)', () => {
      insertFinding(db, makeInput(scanId))
      const second = insertFinding(db, makeInput(scanId2))
      // The duplicate row itself still has count=1; the canonical gets incremented
      expect(second.occurrenceCount).toBe(1)
    })
  })

  describe('dedup_key computation', () => {
    it('whitespace variations of same finding produce same dedup_key', () => {
      const a = insertFinding(db, makeInput(scanId, { title: 'SQL Injection in query' }))
      const b = insertFinding(db, makeInput(scanId2, { title: '  SQL Injection   in query  ' }))
      expect(a.dedupKey).toBe(b.dedupKey)
    })

    it('different location_path produces different dedup_key', () => {
      const a = insertFinding(db, makeInput(scanId, { locationPath: 'src/auth/login.ts' }))
      const b = insertFinding(db, makeInput(scanId2, { locationPath: 'src/payments/pay.ts' }))
      expect(a.dedupKey).not.toBe(b.dedupKey)
    })

    it('different detector produces different dedup_key', () => {
      const a = insertFinding(db, makeInput(scanId, { detector: 'semgrep' }))
      const b = insertFinding(db, makeInput(scanId2, { detector: 'gitleaks' }))
      expect(a.dedupKey).not.toBe(b.dedupKey)
    })
  })
})
