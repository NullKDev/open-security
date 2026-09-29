import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import {
  createScan,
  getScanById,
  listScansByProject,
  listScanChildren,
  updateScanStatus,
} from '@/lib/repos/scans.repo'

describe('scans.repo', () => {
  let db: ReturnType<typeof createTestDb>
  let projectId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    const proj = createProject(db, {
      name: 'test',
      sourceKind: 'github',
      sourceRef: 'url',
    })
    projectId = proj.id
  })

  it('creates a scan with default status pending', () => {
    const scan = createScan(db, { projectId })
    expect(scan.id).toBeTruthy()
    expect(scan.status).toBe('pending')
    expect(scan.stage).toBeNull()
    expect(scan.projectId).toBe(projectId)
  })

  it('first scan in a project gets version 1', () => {
    const scan = createScan(db, { projectId })
    expect(scan.version).toBe(1)
  })

  it('second scan in a project gets version 2', () => {
    createScan(db, { projectId })
    const scan2 = createScan(db, { projectId })
    expect(scan2.version).toBe(2)
  })

  it('persists prompt when provided', () => {
    const prompt = 'Only scan the auth module'
    const scan = createScan(db, { projectId, prompt })
    const found = getScanById(db, scan.id)
    expect(found?.prompt).toBe(prompt)
  })

  it('prompt is null when not provided', () => {
    const scan = createScan(db, { projectId })
    expect(scan.prompt).toBeNull()
  })

  it('persists parentId when provided', () => {
    const parent = createScan(db, { projectId })
    const child = createScan(db, { projectId, parentId: parent.id })
    expect(child.parentId).toBe(parent.id)
  })

  it('parentId is null for root scan', () => {
    const scan = createScan(db, { projectId })
    expect(scan.parentId).toBeNull()
  })

  it('listScanChildren returns direct children only', () => {
    const root = createScan(db, { projectId })
    const child1 = createScan(db, { projectId, parentId: root.id })
    const child2 = createScan(db, { projectId, parentId: root.id })
    createScan(db, { projectId }) // sibling root — not a child

    const children = listScanChildren(db, root.id)
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.id)).toContain(child1.id)
    expect(children.map((c) => c.id)).toContain(child2.id)
  })

  it('listScanChildren returns empty array for a scan with no children', () => {
    const scan = createScan(db, { projectId })
    expect(listScanChildren(db, scan.id)).toHaveLength(0)
  })

  it('version is project-scoped — two projects each start at 1', () => {
    const proj2 = createProject(db, { name: 'p2', sourceKind: 'github', sourceRef: 'url2' })
    const s1 = createScan(db, { projectId })
    const s2 = createScan(db, { projectId: proj2.id })
    expect(s1.version).toBe(1)
    expect(s2.version).toBe(1)
  })

  it('reads a scan by id', () => {
    const scan = createScan(db, { projectId })
    const found = getScanById(db, scan.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(scan.id)
  })

  it('returns undefined for non-existent scan', () => {
    expect(getScanById(db, 'nonexistent')).toBeUndefined()
  })

  it('lists scans by project', () => {
    createScan(db, { projectId })
    createScan(db, { projectId })
    expect(listScansByProject(db, projectId)).toHaveLength(2)
  })

  it('transitions status: pending → running → done', () => {
    const scan = createScan(db, { projectId })

    const running = updateScanStatus(db, scan.id, 'running')
    expect(running.status).toBe('running')
    expect(running.startedAt).toBeTruthy()

    const done = updateScanStatus(db, scan.id, 'done')
    expect(done.status).toBe('done')
    expect(done.finishedAt).toBeTruthy()
  })

  it('transitions status: pending → cancelled', () => {
    const scan = createScan(db, { projectId })
    expect(updateScanStatus(db, scan.id, 'cancelled').status).toBe('cancelled')
  })

  it('persists error message when transitioning to failed', () => {
    const scan = createScan(db, { projectId })
    const failed = updateScanStatus(db, scan.id, 'failed', 'Something went wrong')
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('Something went wrong')
  })
})
