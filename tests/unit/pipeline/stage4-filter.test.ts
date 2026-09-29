/**
 * tests/unit/pipeline/stage4-filter.test.ts
 *
 * Tests for Stage 4 — False-Positive Filter
 * Covers: glob→regex conversion, rule matching, event emission.
 */
import { describe, it, expect } from 'vitest'
import { globToRegex, runStage4Filter } from '@/lib/pipeline/stage4-filter'
import type { NormalizedFinding } from '@/lib/scanners/types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stagingFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    title: 'Test Finding',
    description: 'Test description',
    severity: 'medium',
    locationPath: 'src/app/page.tsx',
    locationLineStart: 10,
    detector: 'llm',
    ...overrides,
  }
}

function rule(match_path: string): { id: string; pathRegex: RegExp } {
  return { id: `rule-${match_path}`, pathRegex: globToRegex(match_path) }
}

// ─── globToRegex ───────────────────────────────────────────────────────────────

describe('globToRegex', () => {
  it('matches literal path', () => {
    const re = globToRegex('src/file.ts')
    expect(re.test('src/file.ts')).toBe(true)
    expect(re.test('src/other.ts')).toBe(false)
    expect(re.test('other/src/file.ts')).toBe(false)
  })

  it('matches single-segment wildcard *', () => {
    const re = globToRegex('src/*.ts')
    expect(re.test('src/file.ts')).toBe(true)
    expect(re.test('src/sub/file.ts')).toBe(false)
    expect(re.test('src/file.js')).toBe(false)
  })

  it('matches recursive wildcard **', () => {
    const re = globToRegex('src/**/*.ts')
    expect(re.test('src/file.ts')).toBe(true)
    expect(re.test('src/sub/file.ts')).toBe(true)
    expect(re.test('src/a/b/c/file.ts')).toBe(true)
    expect(re.test('lib/file.ts')).toBe(false)
  })

  it('matches ** without trailing slash', () => {
    const re = globToRegex('**/*.test.*')
    expect(re.test('src/__tests__/button.test.tsx')).toBe(true)
    expect(re.test('button.test.ts')).toBe(true)
    expect(re.test('src/app/page.tsx')).toBe(false)
  })

  it('matches fixtures pattern', () => {
    const re = globToRegex('**/fixtures/**')
    expect(re.test('tests/fixtures/data.json')).toBe(true)
    expect(re.test('src/tests/fixtures/mock.json')).toBe(true)
    expect(re.test('src/app/page.tsx')).toBe(false)
  })

  it('matches __mocks__ pattern', () => {
    const re = globToRegex('**/__mocks__/**')
    expect(re.test('src/__mocks__/fs.ts')).toBe(true)
    expect(re.test('__mocks__/handler.ts')).toBe(true)
    expect(re.test('src/app/__mocks__/page.tsx')).toBe(true)
    expect(re.test('src/app/page.tsx')).toBe(false)
  })

  it('escapes regex specials in path', () => {
    const re = globToRegex('src/app/[id]/page.tsx')
    expect(re.test('src/app/[id]/page.tsx')).toBe(true)
    expect(re.test('src/app/123/page.tsx')).toBe(false)
  })

  it('handles dot in extension correctly (anchors at end)', () => {
    const re = globToRegex('*.test.ts')
    expect(re.test('button.test.ts')).toBe(true)
    expect(re.test('button.test.tsx')).toBe(false)
    expect(re.test('button.spec.ts')).toBe(false)
  })

  it('matches ** glob (everything)', () => {
    const re = globToRegex('**')
    expect(re.test('anything')).toBe(true)
    expect(re.test('src/a/b/c/d.ts')).toBe(true)
  })
})

// ─── runStage4Filter — rule matching (via _rules injection) ────────────────────

describe('runStage4Filter', () => {
  it('drops finding matching a glob rule', async () => {
    const validated = [
      {
        finding: stagingFinding({ title: 'XSS in test', locationPath: 'src/button.test.tsx' }),
        passes: true,
        rationale: 'confirmed',
        model: 'test',
      },
    ]

    const result = await runStage4Filter({
      scanId: 'test-1',
      validated,
      onEvent: () => {},
      _fpRules: [rule('**/*.test.*')],
    })

    expect(result.filtered).toHaveLength(0)
    expect(result.droppedCount).toBe(1)
  })

  it('keeps finding when no rule matches', async () => {
    const validated = [
      {
        finding: stagingFinding({ title: 'SQLi', locationPath: 'src/app/api/users.ts' }),
        passes: true,
        rationale: 'confirmed',
        model: 'test',
      },
    ]

    const result = await runStage4Filter({
      scanId: 'test-2',
      validated,
      onEvent: () => {},
      _fpRules: [rule('**/*.test.*'), rule('**/fixtures/**')],
    })

    expect(result.filtered).toHaveLength(1)
    expect(result.droppedCount).toBe(0)
  })

  it('only processes true positives (passes=true)', async () => {
    const validated = [
      {
        finding: stagingFinding({ title: 'Real vuln', locationPath: 'src/app.ts' }),
        passes: true,
        rationale: 'confirmed',
        model: 'test',
      },
      {
        finding: stagingFinding({ title: 'FP', locationPath: 'src/other.ts' }),
        passes: false,
        rationale: 'false positive',
        model: 'test',
      },
    ]

    const result = await runStage4Filter({
      scanId: 'test-3',
      validated,
      onEvent: () => {},
      _fpRules: [rule('**')],
    })

    // Only the true positive is considered — gets dropped by '**'
    expect(result.filtered).toHaveLength(0)
    expect(result.droppedCount).toBe(1)
  })

  it('emits progress events for dropped findings', async () => {
    const events: string[] = []
    const validated = [
      {
        finding: stagingFinding({ title: 'Vuln in test', locationPath: 'src/button.test.tsx' }),
        passes: true,
        rationale: 'confirmed',
        model: 'test',
      },
    ]

    await runStage4Filter({
      scanId: 'test-4',
      validated,
      onEvent: (evt) => {
        if (evt.type === 'progress') events.push(evt.message)
      },
      _fpRules: [rule('**/*.test.*')],
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toContain('FP filter dropped')
    expect(events[0]).toContain('Vuln in test')
    expect(events[0]).toContain('rule-**/*.test.*')
  })

  it('handles empty validated array', async () => {
    const result = await runStage4Filter({
      scanId: 'test-5',
      validated: [],
      onEvent: () => {},
      _fpRules: [rule('**')],
    })

    expect(result.filtered).toHaveLength(0)
    expect(result.droppedCount).toBe(0)
  })

  it('handles empty rules (no filtering)', async () => {
    const validated = [
      {
        finding: stagingFinding({ title: 'Should pass through' }),
        passes: true,
        rationale: 'confirmed',
        model: 'test',
      },
    ]

    const result = await runStage4Filter({
      scanId: 'test-6',
      validated,
      onEvent: () => {},
      _fpRules: [],
    })

    expect(result.filtered).toHaveLength(1)
    expect(result.droppedCount).toBe(0)
  })

  it('matches __mocks__ and fixtures paths correctly (real fp-filter.yaml rules)', async () => {
    const rules = [
      rule('**/*.test.*'),
      rule('**/fixtures/**'),
      rule('**/__mocks__/**'),
    ]

    const findings = [
      { path: 'src/button.test.tsx', shouldDrop: true },
      { path: 'tests/fixtures/data.json', shouldDrop: true },
      { path: 'src/__mocks__/fs.ts', shouldDrop: true },
      { path: 'src/app/page.tsx', shouldDrop: false },
      { path: 'lib/utils.ts', shouldDrop: false },
      { path: 'app/api/auth/route.ts', shouldDrop: false },
    ]

    for (const { path, shouldDrop } of findings) {
      const result = await runStage4Filter({
        scanId: 'test-real',
        validated: [{
          finding: stagingFinding({ locationPath: path }),
          passes: true,
          rationale: 'confirmed',
          model: 'test',
        }],
        onEvent: () => {},
        _fpRules: rules,
      })

      expect(result.filtered.length).toBe(shouldDrop ? 0 : 1)
    }
  })
})
