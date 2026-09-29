/**
 * tests/unit/db/integrity.test.ts
 *
 * TDD: T-048 (RED) → GREEN — lib/db/integrity.ts
 *
 * Tests the checkIntegrity function which:
 * - Validates findings.status values against the allowed set
 * - Validates fix_proofs.outcome values against the allowed set
 * - Returns { ok: true, issues: [] } when clean
 * - Returns { ok: false, issues: [...] } on violations
 * - Never throws — always returns a report
 */
import { describe, it, expect } from 'vitest'
import { checkIntegrity } from '@/lib/db/integrity'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

type QueryRow = Record<string, unknown>

/**
 * Creates a mock DB that returns specific rows for each query call in order.
 * First call to .all() returns findingRows, second returns proofRows.
 */
function makeMockDb(
  findingRows: QueryRow[],
  proofRows: QueryRow[],
): BetterSQLite3Database<typeof schema> {
  let callCount = 0
  const mock = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return findingRows
      return proofRows
    }),
  }
  return mock as unknown as BetterSQLite3Database<typeof schema>
}

import { vi } from 'vitest'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkIntegrity', () => {
  it('returns ok=true and no issues when all data is valid', () => {
    const db = makeMockDb([], [])
    const result = checkIntegrity(db)
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('reports invalid findings.status values', () => {
    const db = makeMockDb(
      [{ status: 'garbage', cnt: 3 }],
      [],
    )
    const result = checkIntegrity(db)
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatch(/findings\.status/)
    expect(result.issues[0]).toMatch(/garbage/)
    expect(result.issues[0]).toMatch(/3/)
  })

  it('reports invalid fix_proofs.outcome values', () => {
    const db = makeMockDb(
      [],
      [{ outcome: 'bad-outcome', cnt: 1 }],
    )
    const result = checkIntegrity(db)
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatch(/fix_proofs\.outcome/)
    expect(result.issues[0]).toMatch(/bad-outcome/)
  })

  it('reports multiple violations across both tables', () => {
    const db = makeMockDb(
      [{ status: 'invalid1', cnt: 2 }],
      [{ outcome: 'invalid2', cnt: 5 }],
    )
    const result = checkIntegrity(db)
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(2)
  })

  it('does not report valid findings.status values', () => {
    const db = makeMockDb(
      // Simulate query returning all valid statuses (should be empty because we filter)
      [],
      [],
    )
    const result = checkIntegrity(db)
    expect(result.ok).toBe(true)
  })

  it('does not throw on DB error — returns an issue instead', () => {
    const errorDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      all: vi.fn().mockImplementation(() => {
        throw new Error('DB connection lost')
      }),
    } as unknown as BetterSQLite3Database<typeof schema>

    // Must never throw
    let result: ReturnType<typeof checkIntegrity>
    expect(() => {
      result = checkIntegrity(errorDb)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    expect(result!.issues[0]).toMatch(/DB connection lost/)
  })
})
