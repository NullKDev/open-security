import { describe, it, expect } from 'vitest'
import { QuickStrategy } from '@/lib/pipeline/strategies/quick'
import type { StrategyContext } from '@/lib/pipeline/strategies/types'
import type { NormalizedFinding } from '@/lib/scanners/types'

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'test-scan',
    workspaceRoot: '/tmp/test',
    targetPath: '/tmp/test/source',
    classicalFindings: [],
    stage0Stack: [],
    scanMode: 'quick',
    llmProvider: undefined,
    onEvent: () => {},
    isAborted: () => false,
    ...overrides,
  }
}

function makeF(title: string, path: string, line: number): NormalizedFinding {
  return {
    title,
    description: 'desc',
    severity: 'medium',
    locationPath: path,
    locationLineStart: line,
    detector: 'some-scanner',
  }
}

describe('QuickStrategy', () => {
  it('returns empty findings when classicalFindings is empty', async () => {
    const strategy = new QuickStrategy()
    const ctx = makeCtx({ classicalFindings: [] })
    const result = await strategy.run(ctx)
    expect(result.findings).toEqual([])
  })

  it('returns same classical findings array', async () => {
    const strategy = new QuickStrategy()
    const findings = [
      makeF('SQL Injection', 'src/db.ts', 10),
      makeF('XSS', 'src/app.tsx', 42),
    ]
    const ctx = makeCtx({ classicalFindings: findings })
    const result = await strategy.run(ctx)
    expect(result.findings).toEqual(findings)
    expect(result.findings).toHaveLength(2)
  })

  it('has llmSkipped always true', async () => {
    const strategy = new QuickStrategy()
    const ctx = makeCtx()
    const result = await strategy.run(ctx)
    expect(result.llmSkipped).toBe(true)
  })

  it('does not modify the original findings array', async () => {
    const strategy = new QuickStrategy()
    const original = [makeF('Test', 'a.ts', 1)]
    const ctx = makeCtx({ classicalFindings: original })
    const result = await strategy.run(ctx)
    expect(result.findings).toBe(original)
    expect(result.findings[0].title).toBe('Test')
  })
})
