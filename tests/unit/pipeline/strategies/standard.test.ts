import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StandardStrategy } from '@/lib/pipeline/strategies/standard'
import type { StrategyContext } from '@/lib/pipeline/strategies/types'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ProviderClient, ProviderEvent } from '@/lib/providers/index'

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'test-scan',
    workspaceRoot: '/tmp/test',
    targetPath: '/tmp/test/source',
    classicalFindings: [],
    stage0Stack: [],
    scanMode: 'standard',
    llmProvider: undefined,
    onEvent: () => {},
    isAborted: () => false,
    ...overrides,
  }
}

function makeF(title: string, path: string, line: number, detector = 'classical-scanner'): NormalizedFinding {
  return {
    title,
    description: 'desc',
    severity: 'medium',
    locationPath: path,
    locationLineStart: line,
    detector,
  }
}

function mockProvider(): ProviderClient {
  return {
    id: 'mock:test',
    capability: { stream: true, tools: false, jsonMode: false },
    async *scan(): AsyncIterable<ProviderEvent> {
      yield { type: 'done' }
    },
  }
}

// Mock stage2-llm to control returned findings
const mockRunStage2Llm = vi.fn()
vi.mock('@/lib/pipeline/stage2-llm', () => ({
  runStage2Llm: (...args: unknown[]) => mockRunStage2Llm(...args),
}))

describe('StandardStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('merges classical and LLM findings when provider is available', async () => {
    const llmFindings = [
      makeF('LLM Finding 1', 'src/llm.ts', 5, 'llm'),
      makeF('LLM Finding 2', 'src/llm2.ts', 10, 'llm'),
    ]
    mockRunStage2Llm.mockResolvedValue({ findings: llmFindings })

    const classical = [makeF('Classical Finding', 'src/classical.ts', 1, 'classical-scanner')]

    const strategy = new StandardStrategy()
    const ctx = makeCtx({
      classicalFindings: classical,
      llmProvider: mockProvider(),
    })

    const result = await strategy.run(ctx)

    expect(mockRunStage2Llm).toHaveBeenCalledTimes(1)
    expect(result.findings).toHaveLength(3)
    expect(result.findings[0].detector).toBe('classical-scanner')
    expect(result.findings[1].detector).toBe('llm')
    expect(result.findings[2].detector).toBe('llm')
  })

  it('returns classical-only findings when no LLM provider is configured', async () => {
    const classical = [
      makeF('Finding A', 'a.ts', 1),
      makeF('Finding B', 'b.ts', 2),
    ]

    const strategy = new StandardStrategy()
    const ctx = makeCtx({
      classicalFindings: classical,
      llmProvider: undefined,
    })

    const result = await strategy.run(ctx)

    expect(mockRunStage2Llm).not.toHaveBeenCalled()
    expect(result.findings).toEqual(classical)
    expect(result.findings).toHaveLength(2)
    expect(result.llmSkipped).toBe(true)
  })

  it('has llmSkipped as false when provider is available', async () => {
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new StandardStrategy()
    const ctx = makeCtx({ llmProvider: mockProvider() })

    const result = await strategy.run(ctx)
    expect(result.llmSkipped).toBe(false)
  })

  it('calls runStage2Llm with prompt built from stack and userPrompt', async () => {
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new StandardStrategy()
    const ctx = makeCtx({
      stage0Stack: ['react', 'typescript'],
      prompt: 'Focus on auth',
      llmProvider: mockProvider(),
    })

    await strategy.run(ctx)

    expect(mockRunStage2Llm).toHaveBeenCalledTimes(1)
    const callArgs = mockRunStage2Llm.mock.calls[0][0]
    expect(callArgs.prompt).toBeTruthy()
    expect(callArgs.prompt).toContain('security engineer')
  })

  it('returns empty merged array when both classical and LLM are empty', async () => {
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new StandardStrategy()
    const ctx = makeCtx({
      classicalFindings: [],
      llmProvider: mockProvider(),
    })

    const result = await strategy.run(ctx)
    expect(result.findings).toEqual([])
    expect(result.llmSkipped).toBe(false)
  })
})
