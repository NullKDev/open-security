/**
 * tests/unit/repos/playbooks.test.ts
 *
 * TDD: T-025 (RED) → T-026 (GREEN)
 * Tests for playbooks.repo.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import {
  listPlaybooks,
  upsertPlaybook,
  deletePlaybook,
} from '@/lib/repos/playbooks.repo'

const makePlaybook = (overrides?: Partial<Parameters<typeof upsertPlaybook>[1]>) => ({
  id: 'pb-001',
  name: 'Find SSRF',
  version: '1.0.0',
  description: 'Hunts for SSRF patterns',
  promptTemplate: 'Analyze {{target}} for SSRF vulnerabilities.',
  scannerScope: JSON.stringify(['semgrep']),
  parameters: null,
  source: 'user' as const,
  builtIn: 0,
  trusted: 0,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('playbooks.repo', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
  })

  describe('listPlaybooks', () => {
    it('returns empty array when no playbooks exist', () => {
      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(0)
    })

    it('returns all inserted playbooks', () => {
      upsertPlaybook(db, makePlaybook({ id: 'pb-001', name: 'A' }))
      upsertPlaybook(db, makePlaybook({ id: 'pb-002', name: 'B' }))

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(2)
      const names = rows.map((r) => r.name)
      expect(names).toContain('A')
      expect(names).toContain('B')
    })

    it('returns both builtin and user playbooks', () => {
      upsertPlaybook(db, makePlaybook({ id: 'builtin-1', source: 'builtin', builtIn: 1 }))
      upsertPlaybook(db, makePlaybook({ id: 'user-1', source: 'user', builtIn: 0 }))

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(2)
      const sources = rows.map((r) => r.source)
      expect(sources).toContain('builtin')
      expect(sources).toContain('user')
    })
  })

  describe('upsertPlaybook — create', () => {
    it('inserts a new playbook row', () => {
      upsertPlaybook(db, makePlaybook())

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('pb-001')
      expect(rows[0].name).toBe('Find SSRF')
      expect(rows[0].version).toBe('1.0.0')
      expect(rows[0].promptTemplate).toBe('Analyze {{target}} for SSRF vulnerabilities.')
    })

    it('silently replaces on duplicate id (upsert semantics)', () => {
      upsertPlaybook(db, makePlaybook({ id: 'dup-id', name: 'Original' }))
      upsertPlaybook(db, makePlaybook({ id: 'dup-id', name: 'Replaced' }))

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Replaced')
    })
  })

  describe('upsertPlaybook — update', () => {
    it('updates an existing playbook when called with same id (upsert)', () => {
      upsertPlaybook(db, makePlaybook({ id: 'pb-upd', name: 'Original', version: '1.0.0' }))
      upsertPlaybook(db, makePlaybook({ id: 'pb-upd', name: 'Updated', version: '2.0.0' }))

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Updated')
      expect(rows[0].version).toBe('2.0.0')
    })
  })

  describe('deletePlaybook', () => {
    it('removes a playbook by id', () => {
      upsertPlaybook(db, makePlaybook({ id: 'pb-del' }))
      expect(listPlaybooks(db)).toHaveLength(1)

      deletePlaybook(db, 'pb-del')
      expect(listPlaybooks(db)).toHaveLength(0)
    })

    it('is a no-op when id does not exist', () => {
      expect(() => deletePlaybook(db, 'nonexistent')).not.toThrow()
    })

    it('only removes the specified playbook', () => {
      upsertPlaybook(db, makePlaybook({ id: 'pb-keep', name: 'Keep' }))
      upsertPlaybook(db, makePlaybook({ id: 'pb-remove', name: 'Remove' }))

      deletePlaybook(db, 'pb-remove')

      const rows = listPlaybooks(db)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('pb-keep')
    })
  })
})
