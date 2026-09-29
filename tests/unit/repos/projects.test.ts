import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject, getProjectById, listProjects } from '@/lib/repos/projects.repo'
import type { ProjectDTO } from '@/lib/repos/projects.repo'

describe('projects.repo', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  it('creates a project and reads it back by id', () => {
    const project = createProject(db, {
      name: 'test-repo',
      sourceKind: 'github',
      sourceRef: 'https://github.com/test/repo',
    })

    expect(project.id).toBeTruthy()
    expect(project.name).toBe('test-repo')
    expect(project.sourceKind).toBe('github')
    expect(project.sourceRef).toBe('https://github.com/test/repo')
    expect(project.createdAt).toBeTruthy()

    const found = getProjectById(db, project.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(project.id)
    expect(found!.name).toBe('test-repo')
  })

  it('returns undefined for non-existent id', () => {
    const result = getProjectById(db, 'nonexistent')
    expect(result).toBeUndefined()
  })

  it('lists all projects ordered by creation', () => {
    const a = createProject(db, { name: 'a', sourceKind: 'github', sourceRef: 'url-a' })
    const b = createProject(db, { name: 'b', sourceKind: 'local', sourceRef: '/tmp/b' })

    const all = listProjects(db)
    expect(all).toHaveLength(2)
    expect(all.map((p) => p.name)).toEqual(['a', 'b'])
  })
})
