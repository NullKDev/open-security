import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import {
  insertReport,
  getReportById,
  listReportsByScan,
} from '@/lib/repos/reports.repo'
import type { CreateReportInput } from '@/lib/repos/reports.repo'

describe('reports.repo', () => {
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

  it('inserts a report and reads it back', () => {
    const report = insertReport(db, {
      scanId,
      format: 'json',
      path: '.obt/reports/scan-1/report.json',
    })

    expect(report.id).toBeTruthy()
    expect(report.format).toBe('json')
    expect(report.scanId).toBe(scanId)
    expect(report.generatedAt).toBeTruthy()

    const found = getReportById(db, report.id)
    expect(found).toBeDefined()
    expect(found!.path).toBe('.obt/reports/scan-1/report.json')
  })

  it('returns undefined for non-existent report', () => {
    expect(getReportById(db, 'nonexistent')).toBeUndefined()
  })

  it('lists reports by scan', () => {
    insertReport(db, { scanId, format: 'json', path: 'path-json' })
    insertReport(db, { scanId, format: 'md', path: 'path-md' })
    insertReport(db, { scanId, format: 'sarif', path: 'path-sarif' })

    const reports = listReportsByScan(db, scanId)
    expect(reports).toHaveLength(3)
    const formats = reports.map((r) => r.format).sort()
    expect(formats).toEqual(['json', 'md', 'sarif'])
  })

  it('returns empty array when scan has no reports', () => {
    const reports = listReportsByScan(db, scanId)
    expect(reports).toEqual([])
  })
})
