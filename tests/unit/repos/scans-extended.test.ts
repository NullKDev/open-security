import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan, getScanById, setProjectMap } from '@/lib/repos/scans.repo'

describe('scans.repo — extended modes + projectMap', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    projectId = proj.id
  })

  it('createScan accepts intermediate scanMode', () => {
    const scan = createScan(db, { projectId, scanMode: 'intermediate' })
    expect(scan.scanMode).toBe('intermediate')
  })

  it('createScan accepts paranoid scanMode', () => {
    const scan = createScan(db, { projectId, scanMode: 'paranoid' })
    expect(scan.scanMode).toBe('paranoid')
  })

  it('projectMap defaults to null on new scan', () => {
    const scan = createScan(db, { projectId })
    const found = getScanById(db, scan.id)
    expect(found?.projectMap).toBeNull()
  })

  it('setProjectMap persists JSON string', () => {
    const scan = createScan(db, { projectId })
    const json = JSON.stringify({ stack: ['next.js'], domains: ['auth'] })
    setProjectMap(db, scan.id, json)
    const found = getScanById(db, scan.id)
    expect(found?.projectMap).toBe(json)
  })
})
