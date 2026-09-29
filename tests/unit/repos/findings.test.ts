import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  insertFinding,
  getFindingById,
  listFindings,
  updateFinding,
  deleteFinding,
  updateFindingStatus,
  findingStatusSchema,
} from '@/lib/repos/findings.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

function makeInput(scanId: string, overrides?: Partial<CreateFindingInput>): CreateFindingInput {
  return {
    scanId,
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'AWS Key exposed',
    description: 'Found an AWS access key in config.yaml',
    locationPath: 'config.yaml',
    locationLineStart: 14,
    ...overrides,
  }
}

describe('findings.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, {
      name: 'test',
      sourceKind: 'github',
      sourceRef: 'url',
    })
    const scan = createScan(db, { projectId: proj.id })
    scanId = scan.id
  })

  it('inserts a finding and reads it back', () => {
    const finding = insertFinding(db, makeInput(scanId))
    expect(finding.id).toBeTruthy()
    expect(finding.severity).toBe('high')
    expect(finding.fpFiltered).toBe(false)

    const found = getFindingById(db, finding.id)
    expect(found).toBeDefined()
    expect(found!.title).toBe('AWS Key exposed')
  })

  it('returns undefined for non-existent finding', () => {
    expect(getFindingById(db, 'nonexistent')).toBeUndefined()
  })

  it('lists findings with cursor pagination', () => {
    // Insert 3 findings
    const f1 = insertFinding(db, makeInput(scanId, { title: 'First' }))
    const f2 = insertFinding(db, makeInput(scanId, { title: 'Second' }))
    const f3 = insertFinding(db, makeInput(scanId, { title: 'Third' }))

    // First page: limit 2
    const page1 = listFindings(db, scanId, { limit: 2 })
    expect(page1.findings).toHaveLength(2)
    expect(page1.nextCursor).toBeTruthy()

    // Second page: use cursor
    const page2 = listFindings(db, scanId, { cursor: page1.nextCursor!, limit: 2 })
    expect(page2.findings).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
  })

  it('patches finding fields: mark as false positive', () => {
    const finding = insertFinding(db, makeInput(scanId))
    expect(finding.fpFiltered).toBe(false)

    const updated = updateFinding(db, finding.id, { fpFiltered: true })
    expect(updated.fpFiltered).toBe(true)

    // Verify persistence
    const reloaded = getFindingById(db, finding.id)
    expect(reloaded!.fpFiltered).toBe(true)
  })

  it('patches finding fields: patch explanation and validation', () => {
    const finding = insertFinding(db, makeInput(scanId))
    const updated = updateFinding(db, finding.id, {
      patchDiff: '-secret\n+redacted',
      patchExplanation: 'Removed hardcoded key',
      validationPasses: true,
    })
    expect(updated.patchDiff).toBe('-secret\n+redacted')
    expect(updated.patchExplanation).toBe('Removed hardcoded key')
    expect(updated.validationPasses).toBe(true)
  })

  it('deletes a finding', () => {
    const finding = insertFinding(db, makeInput(scanId))
    expect(getFindingById(db, finding.id)).toBeDefined()

    deleteFinding(db, finding.id)
    expect(getFindingById(db, finding.id)).toBeUndefined()
  })

  it('delete is idempotent (no error on non-existent)', () => {
    expect(() => deleteFinding(db, 'nonexistent')).not.toThrow()
  })

  // ─── v0.4: status + Fix & Prove + regression fields ──────────

  describe('v0.4 — findingStatusSchema', () => {
    it('accepts all valid status values', () => {
      const valid = ['open', 'fixed', 'dismissed', 'verified-fixed', 'fix-unverified', 'regression']
      for (const s of valid) {
        expect(() => findingStatusSchema.parse(s)).not.toThrow()
      }
    })

    it('rejects unknown status values', () => {
      expect(() => findingStatusSchema.parse('in-progress')).toThrow()
      expect(() => findingStatusSchema.parse('')).toThrow()
    })
  })

  describe('v0.4 — updateFindingStatus', () => {
    it('updates status to a valid value', () => {
      const finding = insertFinding(db, makeInput(scanId))
      const updated = updateFindingStatus(db, finding.id, 'verified-fixed')
      expect(updated.status).toBe('verified-fixed')
    })

    it('throws on invalid status value', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(() => updateFindingStatus(db, finding.id, 'bad-value' as never)).toThrow()
    })
  })

  describe('v0.4 — new DTO fields', () => {
    it('new finding has isRegression=false and status=null', () => {
      const finding = insertFinding(db, makeInput(scanId))
      expect(finding.isRegression).toBe(false)
      expect(finding.status).toBeNull()
      expect(finding.proofOfFixId).toBeNull()
      expect(finding.regressionOfFindingId).toBeNull()
    })

    it('updateFinding accepts isRegression field', () => {
      const finding = insertFinding(db, makeInput(scanId))
      const updated = updateFinding(db, finding.id, { isRegression: true, status: 'regression' })
      expect(updated.isRegression).toBe(true)
      expect(updated.status).toBe('regression')
    })
  })
})
