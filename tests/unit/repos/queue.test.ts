/**
 * tests/unit/repos/queue.test.ts
 *
 * TDD: T-B08 — Queue repo
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { upsertCveScore } from '@/lib/repos/cve-scores.repo'
import { createDismissal, undoDismissal } from '@/lib/repos/finding-dismissals.repo'
import { getQueue, getQueueStats } from '@/lib/repos/queue.repo'
import type { CreateFindingInput } from '@/lib/repos/findings.repo'

function makeInput(scanId: string, overrides?: Partial<CreateFindingInput>): CreateFindingInput {
  return {
    scanId,
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: 'SQL Injection in login',
    locationPath: 'src/auth/login.ts',
    locationLineStart: 10,
    exploitability: 0.7,
    ...overrides,
  }
}

describe('queue.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test-project', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(db, { projectId: proj.id })
    projectId = proj.id
    scanId = scan.id
  })

  describe('getQueue — canonical only', () => {
    it('returns only canonical findings (canonical_finding_id IS NULL)', () => {
      const canonical = insertFinding(db, makeInput(scanId))

      // Insert a second scan + duplicate finding
      const proj2 = createProject(db, { name: 'p2', sourceKind: 'github', sourceRef: 'url' })
      const scan2 = createScan(db, { projectId: proj2.id })
      const dup = insertFinding(db, makeInput(scan2.id)) // same title/path/detector

      const { items } = getQueue(db, {})
      const ids = items.map((r) => r.id)
      expect(ids).toContain(canonical.id)
      expect(ids).not.toContain(dup.id)
    })

    it('returns empty array when no canonical findings', () => {
      const { items } = getQueue(db, {})
      expect(items).toHaveLength(0)
    })
  })

  describe('getQueue — dismissed findings excluded', () => {
    it('excludes findings with an active dismissal by dedup_key', () => {
      const finding = insertFinding(db, makeInput(scanId))
      createDismissal(db, {
        findingId: finding.id,
        dedupKey: finding.dedupKey!,
        fpType: 'false_positive',
        reason: 'Dismiss for queue exclusion test longer than min',
      })

      const { items } = getQueue(db, {})
      expect(items.map((r) => r.id)).not.toContain(finding.id)
    })

    it('shows finding again after dismissal is undone', () => {
      const finding = insertFinding(db, makeInput(scanId))
      const dismissal = createDismissal(db, {
        findingId: finding.id,
        dedupKey: finding.dedupKey!,
        fpType: 'false_positive',
        reason: 'Temporary dismissal for test purposes here',
      })

      undoDismissal(db, dismissal.id)

      const { items } = getQueue(db, {})
      expect(items.map((r) => r.id)).toContain(finding.id)
    })
  })

  describe('getQueue — severity filter', () => {
    it('returns only matching severity when filter applied', () => {
      const high = insertFinding(db, makeInput(scanId, { severity: 'high', title: 'High severity finding' }))
      const critical = insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'Critical severity finding' }))
      const low = insertFinding(db, makeInput(scanId, { severity: 'low', title: 'Low severity finding', locationPath: 'src/low.ts' }))

      const { items } = getQueue(db, { severity: ['high', 'critical'] })
      const ids = items.map((r) => r.id)
      expect(ids).toContain(high.id)
      expect(ids).toContain(critical.id)
      expect(ids).not.toContain(low.id)
    })
  })

  describe('getQueue — KEV ranking', () => {
    it('KEV finding ranks above non-KEV finding with same EPSS and age', () => {
      // Two findings with identical exploitability but one has KEV CVE
      const kevFinding = insertFinding(db, makeInput(scanId, {
        severity: 'high',
        title: 'KEV vulnerability title unique',
        locationPath: 'src/kev.ts',
        exploitability: 0.8,
      }))
      const noKevFinding = insertFinding(db, makeInput(scanId, {
        severity: 'high',
        title: 'No KEV vulnerability title unique',
        locationPath: 'src/nokev.ts',
        exploitability: 0.8,
      }))

      // Add CVE to kev finding
      const cveId = 'CVE-2024-KEVTEST'
      const sqlite = db.$client
      sqlite.prepare("UPDATE findings SET cve_ids = ? WHERE id = ?").run(
        JSON.stringify([cveId]), kevFinding.id
      )
      upsertCveScore(db, { cveId, epssScore: 0.5, epssPercentile: 0.8, cisaKev: 1, fetchedAt: new Date().toISOString() })

      // Also set cve_ids on noKev finding with non-KEV CVE
      const nonKevCveId = 'CVE-2024-NOKEV'
      db.$client.prepare("UPDATE findings SET cve_ids = ? WHERE id = ?").run(
        JSON.stringify([nonKevCveId]), noKevFinding.id
      )
      upsertCveScore(db, { cveId: nonKevCveId, epssScore: 0.5, epssPercentile: 0.8, cisaKev: 0, fetchedAt: new Date().toISOString() })

      const { items } = getQueue(db, {})
      const ids = items.map((r) => r.id)
      expect(ids.indexOf(kevFinding.id)).toBeLessThan(ids.indexOf(noKevFinding.id))
    })
  })

  describe('getQueue — null EPSS treated as 0.01', () => {
    it('findings with no EPSS data appear in queue (not excluded)', () => {
      const finding = insertFinding(db, makeInput(scanId))
      // No CVE, no cve_scores entry → EPSS defaults to 0.01 in formula

      const { items } = getQueue(db, {})
      expect(items.map((r) => r.id)).toContain(finding.id)
    })
  })

  describe('getQueue — cursor pagination', () => {
    it('returns nextCursor when more items exist beyond limit', () => {
      // Insert more findings than the limit — use different ages so rank_scores are stable
      for (let i = 0; i < 5; i++) {
        const f = insertFinding(db, makeInput(scanId, {
          title: `Unique finding title ${i}`,
          locationPath: `src/file${i}.ts`,
        }))
        // Backdate first_detected_at by (i+1) days to create deterministic rank_scores
        db.$client.prepare("UPDATE findings SET first_detected_at = datetime('now', ?) WHERE id = ?").run(
          `-${i + 1} days`, f.id
        )
      }

      const { items, nextCursor } = getQueue(db, { limit: 3 })
      expect(items).toHaveLength(3)
      expect(nextCursor).toBeTruthy()
    })

    it('second page returns remaining items using cursor — no overlap, no gaps', () => {
      // Insert with different ages to create stable distinct rank_scores
      for (let i = 0; i < 5; i++) {
        const f = insertFinding(db, makeInput(scanId, {
          title: `Page finding ${i}`,
          locationPath: `src/page${i}.ts`,
        }))
        // Different ages: 1 day, 2 days, 3 days... → different ln(1+days_open)
        db.$client.prepare("UPDATE findings SET first_detected_at = datetime('now', ?) WHERE id = ?").run(
          `-${i + 1} days`, f.id
        )
      }

      const page1 = getQueue(db, { limit: 3 })
      expect(page1.items).toHaveLength(3)
      expect(page1.nextCursor).toBeTruthy()

      const page2 = getQueue(db, { limit: 3, cursor: page1.nextCursor! })
      // Page1 + page2 must cover all 5 unique findings with no overlap
      const allIds = [...page1.items.map((r) => r.id), ...page2.items.map((r) => r.id)]
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(5)
      expect(allIds).toHaveLength(5)
    })
  })

  describe('getQueueStats', () => {
    it('returns correct counts by severity', () => {
      insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'Crit 1', locationPath: 'a.ts' }))
      insertFinding(db, makeInput(scanId, { severity: 'critical', title: 'Crit 2', locationPath: 'b.ts' }))
      insertFinding(db, makeInput(scanId, { severity: 'high', title: 'High 1', locationPath: 'c.ts' }))

      const stats = getQueueStats(db)
      expect(stats.total).toBe(3)
      expect(stats.bySeverity.critical).toBe(2)
      expect(stats.bySeverity.high).toBe(1)
    })
  })
})
