/**
 * tests/unit/db/schema-v02.test.ts
 *
 * TDD: T-A01 — Assert new v0.2 columns and tables present after migration.
 *
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

function getColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getIndexes(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table)
  return row !== undefined
}

describe('Schema v0.2 — new columns and tables', () => {
  let sqlite: Database.Database

  beforeEach(() => {
    sqlite = new Database(':memory:')
    createTestDb(sqlite)
  })

  describe('scans table — v0.2 additions', () => {
    it('has strategy column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('strategy')
    })

    it('has base_sha column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('base_sha')
    })

    it('has head_sha column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('head_sha')
    })

    it('has pr_number column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('pr_number')
    })

    it('has pr_comment_id column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('pr_comment_id')
    })

    it('has pr_comment_status column', () => {
      expect(getColumns(sqlite, 'scans')).toContain('pr_comment_status')
    })

    it('strategy defaults to standard', () => {
      // Insert a scan without strategy and verify the default
      sqlite.exec(`
        INSERT INTO projects (id, name, source_kind, source_ref, created_at)
        VALUES ('p1', 'test', 'local', '/tmp', '2026-01-01T00:00:00Z')
      `)
      sqlite.exec(`
        INSERT INTO scans (id, project_id, status)
        VALUES ('s1', 'p1', 'pending')
      `)
      const row = sqlite.prepare(`SELECT strategy FROM scans WHERE id='s1'`).get() as {
        strategy: string
      }
      expect(row.strategy).toBe('standard')
    })
  })

  describe('repos table', () => {
    it('repos table exists', () => {
      expect(tableExists(sqlite, 'repos')).toBe(true)
    })

    it('has all required repos columns', () => {
      const cols = getColumns(sqlite, 'repos')
      expect(cols).toContain('id')
      expect(cols).toContain('project_id')
      expect(cols).toContain('name')
      expect(cols).toContain('local_path')
      expect(cols).toContain('default_branch')
      expect(cols).toContain('watch_enabled')
      expect(cols).toContain('watch_interval')
      expect(cols).toContain('notify_channels')
      expect(cols).toContain('notify_severity_floor')
      expect(cols).toContain('slack_webhook_url_ref')
      expect(cols).toContain('webhook_secret_ref')
      expect(cols).toContain('webhook_proxy_url')
      expect(cols).toContain('created_at')
    })

    it('watch_enabled defaults to 0', () => {
      sqlite.exec(`
        INSERT INTO repos (id, project_id, name, local_path, created_at)
        VALUES ('r1', 'p-none', 'myrepo', '/tmp/r', '2026-01-01T00:00:00Z')
      `)
      const row = sqlite.prepare(`SELECT watch_enabled FROM repos WHERE id='r1'`).get() as {
        watch_enabled: number
      }
      expect(row.watch_enabled).toBe(0)
    })

    it('watch_interval defaults to 0 */6 * * *', () => {
      sqlite.exec(`
        INSERT INTO repos (id, project_id, name, local_path, created_at)
        VALUES ('r2', 'p-none', 'myrepo2', '/tmp/r2', '2026-01-01T00:00:00Z')
      `)
      const row = sqlite.prepare(`SELECT watch_interval FROM repos WHERE id='r2'`).get() as {
        watch_interval: string
      }
      expect(row.watch_interval).toBe('0 */6 * * *')
    })
  })

  describe('webhook_events table', () => {
    it('webhook_events table exists', () => {
      expect(tableExists(sqlite, 'webhook_events')).toBe(true)
    })

    it('has all required webhook_events columns', () => {
      const cols = getColumns(sqlite, 'webhook_events')
      expect(cols).toContain('id')
      expect(cols).toContain('repo_id')
      expect(cols).toContain('delivery_id')
      expect(cols).toContain('event')
      expect(cols).toContain('action')
      expect(cols).toContain('payload')
      expect(cols).toContain('status')
      expect(cols).toContain('received_at')
      expect(cols).toContain('processed_at')
      expect(cols).toContain('scan_id')
      expect(cols).toContain('error')
    })

    it('status defaults to pending', () => {
      sqlite.exec(`
        INSERT INTO webhook_events (id, payload, received_at)
        VALUES ('we1', '{}', '2026-01-01T00:00:00Z')
      `)
      const row = sqlite
        .prepare(`SELECT status FROM webhook_events WHERE id='we1'`)
        .get() as { status: string }
      expect(row.status).toBe('pending')
    })

    it('has unique constraint on delivery_id', () => {
      sqlite.exec(`
        INSERT INTO webhook_events (id, delivery_id, payload, received_at)
        VALUES ('we2', 'delivery-abc', '{}', '2026-01-01T00:00:00Z')
      `)
      expect(() => {
        sqlite.exec(`
          INSERT INTO webhook_events (id, delivery_id, payload, received_at)
          VALUES ('we3', 'delivery-abc', '{}', '2026-01-01T00:00:00Z')
        `)
      }).toThrow()
    })
  })

  describe('watch_locks table', () => {
    it('watch_locks table exists', () => {
      expect(tableExists(sqlite, 'watch_locks')).toBe(true)
    })

    it('has all required watch_locks columns', () => {
      const cols = getColumns(sqlite, 'watch_locks')
      expect(cols).toContain('repo_id')
      expect(cols).toContain('branch')
      expect(cols).toContain('acquired_at')
    })
  })

  describe('notification_log table', () => {
    it('notification_log table exists', () => {
      expect(tableExists(sqlite, 'notification_log')).toBe(true)
    })

    it('has all required notification_log columns', () => {
      const cols = getColumns(sqlite, 'notification_log')
      expect(cols).toContain('id')
      expect(cols).toContain('repo_id')
      expect(cols).toContain('channel')
      expect(cols).toContain('scan_id')
      expect(cols).toContain('finding_count')
      expect(cols).toContain('sent_at')
    })
  })

  describe('findings — scan dedup index', () => {
    it('has scan_dedup composite index on findings', () => {
      const indexes = getIndexes(sqlite, 'findings')
      expect(indexes.some((i) => i.includes('scan_dedup'))).toBe(true)
    })
  })
})
