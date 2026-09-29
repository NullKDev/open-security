import { describe, it, expect } from 'vitest'
import { dedupeKey, dedupeFindings } from '@/lib/pipeline/strategies/dedupe'
import type { NormalizedFinding } from '@/lib/scanners/types'

function makeF(partial: Partial<NormalizedFinding> & { title: string }): NormalizedFinding {
  return {
    description: 'desc',
    severity: 'medium',
    locationPath: 'src/app.ts',
    locationLineStart: 1,
    detector: 'llm',
    ...partial,
  }
}

describe('dedupeKey', () => {
  it('produces path:line:lowercased-title', () => {
    const f = makeF({ title: 'SQL Injection', locationPath: 'src/db.ts', locationLineStart: 42 })
    expect(dedupeKey(f)).toBe('src/db.ts:42:sql injection')
  })

  it('lowercases and trims the title', () => {
    const f = makeF({ title: '  XSS  ', locationPath: 'a.ts', locationLineStart: 1 })
    expect(dedupeKey(f)).toBe('a.ts:1:xss')
  })
})

describe('dedupeFindings', () => {
  it('returns empty array for empty input', () => {
    expect(dedupeFindings([])).toHaveLength(0)
  })

  it('deduplicates two findings with the same key', () => {
    const f1 = makeF({ title: 'SQL Injection', locationPath: 'src/db.ts', locationLineStart: 10 })
    const f2 = makeF({ title: 'sql injection', locationPath: 'src/db.ts', locationLineStart: 10, detector: 'llm:auth' })
    const result = dedupeFindings([f1, f2])
    expect(result).toHaveLength(1)
    // First occurrence wins
    expect(result[0].detector).toBe('llm')
  })

  it('keeps findings with different paths', () => {
    const f1 = makeF({ title: 'XSS', locationPath: 'a.ts', locationLineStart: 1 })
    const f2 = makeF({ title: 'XSS', locationPath: 'b.ts', locationLineStart: 1 })
    expect(dedupeFindings([f1, f2])).toHaveLength(2)
  })

  it('keeps findings with different line numbers', () => {
    const f1 = makeF({ title: 'XSS', locationPath: 'a.ts', locationLineStart: 1 })
    const f2 = makeF({ title: 'XSS', locationPath: 'a.ts', locationLineStart: 2 })
    expect(dedupeFindings([f1, f2])).toHaveLength(2)
  })

  it('keeps findings with different titles', () => {
    const f1 = makeF({ title: 'XSS', locationPath: 'a.ts', locationLineStart: 1 })
    const f2 = makeF({ title: 'CSRF', locationPath: 'a.ts', locationLineStart: 1 })
    expect(dedupeFindings([f1, f2])).toHaveLength(2)
  })

  it('preserves order of first occurrences', () => {
    const f1 = makeF({ title: 'A', locationPath: 'a.ts', locationLineStart: 1 })
    const f2 = makeF({ title: 'B', locationPath: 'b.ts', locationLineStart: 1 })
    const f3 = makeF({ title: 'A', locationPath: 'a.ts', locationLineStart: 1, detector: 'llm:dup' })
    const result = dedupeFindings([f1, f2, f3])
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('A')
    expect(result[1].title).toBe('B')
  })
})
