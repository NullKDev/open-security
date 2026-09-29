import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb } from '@/lib/db/client'
import { projects, scans, findings, commits, authors, reports, config } from '@/lib/db/schema'

describe('DB Client — in-memory initialization', () => {
  it('initializes without error and all tables exist', () => {
    const sqlite = new Database(':memory:')
    const db = createTestDb(sqlite)

    // Every table should be queryable (empty result, no error thrown)
    expect(db.select().from(projects).all()).toEqual([])
    expect(db.select().from(scans).all()).toEqual([])
    expect(db.select().from(findings).all()).toEqual([])
    expect(db.select().from(commits).all()).toEqual([])
    expect(db.select().from(authors).all()).toEqual([])
    expect(db.select().from(reports).all()).toEqual([])
    expect(db.select().from(config).all()).toEqual([])
  })

  it('supports insert and read-back across related tables', () => {
    const sqlite = new Database(':memory:')
    const db = createTestDb(sqlite)

    // Insert a project
    db.insert(projects).values({
      id: 'proj-1',
      name: 'test-repo',
      sourceKind: 'github',
      sourceRef: 'https://github.com/test/repo',
      createdAt: new Date().toISOString(),
    }).run()

    // Insert a scan referencing the project
    db.insert(scans).values({
      id: 'scan-1',
      projectId: 'proj-1',
      status: 'pending',
    }).run()

    // Read back project
    const proj = db.select().from(projects).where(eq(projects.id, 'proj-1')).get()
    expect(proj).toBeDefined()
    expect(proj!.name).toBe('test-repo')

    // Read back scan with FK relationship intact
    const scan = db.select().from(scans).where(eq(scans.id, 'scan-1')).get()
    expect(scan).toBeDefined()
    expect(scan!.status).toBe('pending')
    expect(scan!.projectId).toBe('proj-1')
  })
})
