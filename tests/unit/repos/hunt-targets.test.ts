/**
 * tests/unit/repos/hunt-targets.test.ts
 *
 * TDD: T-021 (RED) → T-022 (GREEN)
 * Tests for hunt-targets.repo.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  upsertHuntTarget,
  findHuntTargetsByScanId,
} from '@/lib/repos/hunt-targets.repo'

describe('hunt-targets.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const project = createProject(db, {
      name: 'test-project',
      sourceKind: 'local',
      sourceRef: '/tmp/repo',
    })
    const scan = createScan(db, { projectId: project.id })
    scanId = scan.id
  })

  describe('upsertHuntTarget — create', () => {
    it('creates a new hunt target row', () => {
      upsertHuntTarget(db, scanId, {
        id: 'ht-001',
        cveId: 'CVE-2023-44487',
        targetPath: 'src/http/server.ts',
      })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('ht-001')
      expect(rows[0].cveId).toBe('CVE-2023-44487')
      expect(rows[0].targetPath).toBe('src/http/server.ts')
      expect(rows[0].scanId).toBe(scanId)
    })

    it('sets advisoryRaw and verdict when provided', () => {
      const advisory = JSON.stringify({ summary: 'HTTP/2 DoS' })
      upsertHuntTarget(db, scanId, {
        id: 'ht-002',
        cveId: 'CVE-2023-44487',
        targetPath: 'src/server.ts',
        advisoryRaw: advisory,
        verdict: 'exposed',
      })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows[0].advisoryRaw).toBe(advisory)
      expect(rows[0].verdict).toBe('exposed')
    })

    it('advisoryRaw and verdict are null when not provided', () => {
      upsertHuntTarget(db, scanId, {
        id: 'ht-003',
        cveId: 'CVE-2024-0001',
        targetPath: 'src/utils.ts',
      })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows[0].advisoryRaw).toBeNull()
      expect(rows[0].verdict).toBeNull()
    })
  })

  describe('upsertHuntTarget — update', () => {
    it('updates advisoryRaw and verdict on second upsert with same id', () => {
      upsertHuntTarget(db, scanId, {
        id: 'ht-004',
        cveId: 'CVE-2023-12345',
        targetPath: 'src/auth.ts',
      })

      upsertHuntTarget(db, scanId, {
        id: 'ht-004',
        cveId: 'CVE-2023-12345',
        targetPath: 'src/auth.ts',
        advisoryRaw: '{"detail":"updated"}',
        verdict: 'not-exposed',
      })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows).toHaveLength(1)
      expect(rows[0].advisoryRaw).toBe('{"detail":"updated"}')
      expect(rows[0].verdict).toBe('not-exposed')
    })
  })

  describe('findHuntTargetsByScanId', () => {
    it('returns empty array for a scan with no targets', () => {
      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows).toHaveLength(0)
    })

    it('returns only targets belonging to the given scan', () => {
      // Create a second scan
      const project2 = createProject(db, {
        name: 'other-project',
        sourceKind: 'local',
        sourceRef: '/tmp/other',
      })
      const scan2 = createScan(db, { projectId: project2.id })

      upsertHuntTarget(db, scanId, {
        id: 'ht-101',
        cveId: 'CVE-2023-1111',
        targetPath: 'a.ts',
      })
      upsertHuntTarget(db, scan2.id, {
        id: 'ht-102',
        cveId: 'CVE-2023-2222',
        targetPath: 'b.ts',
      })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('ht-101')
    })

    it('returns multiple targets for the same scan', () => {
      upsertHuntTarget(db, scanId, { id: 'ht-201', cveId: 'CVE-A', targetPath: 'a.ts' })
      upsertHuntTarget(db, scanId, { id: 'ht-202', cveId: 'CVE-B', targetPath: 'b.ts' })
      upsertHuntTarget(db, scanId, { id: 'ht-203', cveId: 'CVE-C', targetPath: 'c.ts' })

      const rows = findHuntTargetsByScanId(db, scanId)
      expect(rows).toHaveLength(3)
    })
  })
})
