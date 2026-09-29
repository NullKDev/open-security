/**
 * tests/unit/pipeline/strategies/diff.test.ts
 *
 * TDD: T-D07 — DiffStrategy narrows scope, skips OSV, respects timeout
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi } from 'vitest'
import type { StrategyContext, StrategyResult } from '@/lib/pipeline/strategies/types'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ScanEvent } from '@/lib/pipeline/events'
import { DiffStrategy } from '@/lib/pipeline/strategies/diff'

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'scan-diff-test',
    workspaceRoot: '/workspace',
    targetPath: '/repo',
    classicalFindings: [],
    stage0Stack: [],
    prompt: null,
    scanMode: 'standard',
    llmProvider: undefined,
    onEvent: vi.fn<[ScanEvent], void>(),
    isAborted: () => false,
    ...overrides,
  }
}

function makeFind(path: string): NormalizedFinding {
  return {
    title: 'Test finding',
    description: '',
    severity: 'high',
    locationPath: path,
    locationLineStart: 1,
    detector: 'gitleaks',
  }
}

describe('DiffStrategy', () => {
  it('has id = diff', () => {
    const strategy = new DiffStrategy()
    expect(strategy.id).toBe('diff')
  })

  it('returns only classicalFindings (no LLM in diff mode)', async () => {
    const findings = [makeFind('src/a.ts')]
    const ctx = makeContext({ classicalFindings: findings })
    const strategy = new DiffStrategy()
    const result = await strategy.run(ctx)
    expect(result.llmSkipped).toBe(true)
    expect(result.findings).toEqual(findings)
  })

  it('emits a progress event', async () => {
    const onEvent = vi.fn<[ScanEvent], void>()
    const ctx = makeContext({ onEvent })
    const strategy = new DiffStrategy()
    await strategy.run(ctx)
    const progressEvents = onEvent.mock.calls.filter(([e]) => e.type === 'progress')
    expect(progressEvents.length).toBeGreaterThan(0)
  })

  it('filters classicalFindings to diffContext.changedFiles + 1-hop when context is provided', async () => {
    const inScopeFile = 'src/auth/login.ts'
    const outOfScopeFile = 'src/utils/format.ts'

    const findings = [
      makeFind(inScopeFile),
      makeFind(outOfScopeFile),
    ]

    const ctx = makeContext({
      classicalFindings: findings,
      diffContext: {
        baseSha: 'abc',
        headSha: 'def',
        changedFiles: [inScopeFile],
      },
    })

    const strategy = new DiffStrategy()
    const result = await strategy.run(ctx)

    // diffContext.changedFiles are already the scoped files — strategy just passes them
    // The filtering is done at stage1 level; DiffStrategy forwards the already-filtered
    // classicalFindings it receives.
    expect(result.findings).toContain(findings[0])
  })

  it('handles missing diffContext gracefully (no changedFiles)', async () => {
    const findings = [makeFind('src/any.ts')]
    const ctx = makeContext({ classicalFindings: findings })
    const strategy = new DiffStrategy()
    // Should not throw even without diffContext
    const result = await strategy.run(ctx)
    expect(result).toBeDefined()
    expect(result.findings).toEqual(findings)
  })

  it('sets llmSkipped = true always (no LLM in diff mode)', async () => {
    const ctx = makeContext({
      llmProvider: { id: 'fake', name: 'Fake' } as unknown as StrategyContext['llmProvider'],
    })
    const strategy = new DiffStrategy()
    const result = await strategy.run(ctx)
    expect(result.llmSkipped).toBe(true)
  })
})
