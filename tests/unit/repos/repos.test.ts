/**
 * tests/unit/repos/repos.test.ts
 *
 * TDD: T-B01 — repos.repo CRUD
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import {
  createRepo,
  getRepoById,
  listRepos,
  updateRepo,
  deleteRepo,
  listEnabledWatchRepos,
} from '@/lib/repos/repos.repo'

describe('repos.repo', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  it('createRepo inserts and returns a repo DTO', () => {
    const repo = createRepo(db, {
      name: 'my-repo',
      localPath: '/home/user/projects/my-repo',
      defaultBranch: 'main',
    })
    expect(repo.id).toBeTruthy()
    expect(repo.name).toBe('my-repo')
    expect(repo.localPath).toBe('/home/user/projects/my-repo')
    expect(repo.watchEnabled).toBe(false)
    expect(repo.watchInterval).toBe('0 */6 * * *')
    expect(repo.notifySeverityFloor).toBe('high')
  })

  it('getRepoById returns the repo', () => {
    const created = createRepo(db, { name: 'r1', localPath: '/tmp/r1', defaultBranch: 'main' })
    const found = getRepoById(db, created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
  })

  it('getRepoById returns null for unknown id', () => {
    const found = getRepoById(db, 'nonexistent')
    expect(found).toBeNull()
  })

  it('listRepos returns all repos', () => {
    createRepo(db, { name: 'r1', localPath: '/tmp/r1', defaultBranch: 'main' })
    createRepo(db, { name: 'r2', localPath: '/tmp/r2', defaultBranch: 'dev' })
    const repos = listRepos(db)
    expect(repos).toHaveLength(2)
  })

  it('updateRepo updates fields', () => {
    const created = createRepo(db, { name: 'old', localPath: '/tmp/old', defaultBranch: 'main' })
    const updated = updateRepo(db, created.id, { name: 'new', watchEnabled: true })
    expect(updated.name).toBe('new')
    expect(updated.watchEnabled).toBe(true)
  })

  it('deleteRepo removes the repo', () => {
    const created = createRepo(db, { name: 'del', localPath: '/tmp/del', defaultBranch: 'main' })
    deleteRepo(db, created.id)
    expect(getRepoById(db, created.id)).toBeNull()
  })

  it('listEnabledWatchRepos returns only watch-enabled repos', () => {
    createRepo(db, { name: 'disabled', localPath: '/tmp/d', defaultBranch: 'main', watchEnabled: false })
    createRepo(db, { name: 'enabled', localPath: '/tmp/e', defaultBranch: 'main', watchEnabled: true })
    const watchable = listEnabledWatchRepos(db)
    expect(watchable).toHaveLength(1)
    expect(watchable[0].name).toBe('enabled')
  })
})
