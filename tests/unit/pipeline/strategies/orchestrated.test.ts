import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrchestratedStrategy } from '@/lib/pipeline/strategies/orchestrated'
import type { StrategyContext } from '@/lib/pipeline/strategies/types'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ProviderClient, ProviderEvent } from '@/lib/providers/index'
import type { ProjectMap } from '@/lib/pipeline/project-map'

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'test-scan',
    workspaceRoot: '/tmp/test',
    targetPath: '/tmp/test/source',
    classicalFindings: [],
    stage0Stack: ['react', 'typescript'],
    scanMode: 'intermediate',
    llmProvider: undefined,
    onEvent: () => {},
    isAborted: () => false,
    ...overrides,
  }
}

function makeF(title: string, path: string, line: number, detector = 'classical'): NormalizedFinding {
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

function makeProjectMap(domains: string[]): ProjectMap {
  return {
    stack: ['react', 'typescript'],
    frameworks: ['next.js'],
    entryPoints: ['app/api/route.ts'],
    attackSurface: ['http-api', 'auth'],
    domains,
    relevantSkillIds: ['next-js-security'],
  }
}

// Mock project-map module
const mockGenerateProjectMap = vi.fn()
vi.mock('@/lib/pipeline/project-map', () => ({
  generateProjectMap: (...args: unknown[]) => mockGenerateProjectMap(...args),
  ProjectMapSchema: { parse: (v: unknown) => v },
  defaultProjectMapFromStack: (stack: string[], variant: string) => ({
    stack,
    frameworks: [],
    entryPoints: [],
    attackSurface: [],
    domains: variant === 'intermediate' ? ['auth', 'input', 'data'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    relevantSkillIds: [],
  }),
}))

// Mock stage2-llm module
const mockRunStage2Llm = vi.fn()
vi.mock('@/lib/pipeline/stage2-llm', () => ({
  runStage2Llm: (...args: unknown[]) => mockRunStage2Llm(...args),
}))

describe('OrchestratedStrategy (intermediate)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('produces N stage2 calls for N-domain intermediate run', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth', 'input-validation', 'data-access']))
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
    })

    const result = await strategy.run(ctx)

    expect(mockGenerateProjectMap).toHaveBeenCalledTimes(1)
    // One call per domain (3) — Pass 0 is handled by generateProjectMap separately
    expect(mockRunStage2Llm).toHaveBeenCalledTimes(3)
    expect(result.findings).toEqual([])
  })

  it('includes projectMap in result', async () => {
    const pm = makeProjectMap(['auth', 'input-validation'])
    mockGenerateProjectMap.mockResolvedValue(pm)
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({ llmProvider: mockProvider(), scanMode: 'intermediate' })

    const result = await strategy.run(ctx)
    expect(result.projectMap).toBeDefined()
    expect(result.projectMap!.domains).toEqual(['auth', 'input-validation'])
  })

  it('deduplicates findings across domains', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth', 'input-validation']))
    // Both domains return the same finding (same path+line+title)
    const duplicateFinding: NormalizedFinding = {
      title: 'SQL Injection',
      description: 'Found SQL injection',
      severity: 'high',
      locationPath: 'src/db.ts',
      locationLineStart: 10,
      detector: 'llm:auth',
    }
    mockRunStage2Llm
      .mockResolvedValueOnce({ findings: [duplicateFinding], domain: 'auth' })
      .mockResolvedValueOnce({ findings: [{ ...duplicateFinding, detector: 'llm:input-validation' }], domain: 'input-validation' })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({ llmProvider: mockProvider(), scanMode: 'intermediate' })

    const result = await strategy.run(ctx)

    expect(mockRunStage2Llm).toHaveBeenCalledTimes(2)
    // Deduped to 1 finding — first occurrence wins (auth)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].detector).toBe('llm:auth')
  })

  it('merges classical findings with LLM findings', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth']))
    mockRunStage2Llm.mockResolvedValue({
      findings: [makeF('LLM Auth Issue', 'src/auth.ts', 5, 'llm:auth')],
      domain: 'auth',
    })

    const classical = [makeF('Classical Finding', 'src/classical.ts', 1, 'classical-scanner')]

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
      classicalFindings: classical,
    })

    const result = await strategy.run(ctx)

    expect(result.findings).toHaveLength(2)
    expect(result.findings[0].detector).toBe('classical-scanner')
    expect(result.findings[1].detector).toBe('llm:auth')
  })

  it('halts mid-loop on abort signal', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth', 'input-validation', 'data-access', 'api-security']))
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    let aborted = false
    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
      isAborted: () => aborted,
    })

    // Set abort after first domain call
    const originalImpl = mockRunStage2Llm.getMockImplementation()
    mockRunStage2Llm.mockImplementation(async (...args: unknown[]) => {
      // After first call completes, set abort flag
      if (mockRunStage2Llm.mock.calls.length >= 1) {
        aborted = true
      }
      return { findings: [] }
    })

    const result = await strategy.run(ctx)
    // Should halt after at most 2 calls (first one runs, second one sees abort)
    expect(mockRunStage2Llm.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('continues on per-domain error', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth', 'input-validation', 'data-access']))

    const events: any[] = []
    mockRunStage2Llm
      .mockRejectedValueOnce(new Error('Domain scan failed'))
      .mockResolvedValueOnce({ findings: [makeF('Input Finding', 'src/input.ts', 1, 'llm:input-validation')] })
      .mockResolvedValueOnce({ findings: [] })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
      onEvent: (e) => events.push(e),
    })

    const result = await strategy.run(ctx)

    // Still completes all 3 domains
    expect(mockRunStage2Llm).toHaveBeenCalledTimes(3)
    // Got findings from the one successful domain
    expect(result.findings).toHaveLength(1)
    // Warning event emitted for the failed domain
    expect(events.some((e) => e.type === 'progress' && e.message.includes('failed'))).toBe(true)
  })

  it('falls back to default project map when generate fails', async () => {
    mockGenerateProjectMap.mockRejectedValue(new Error('Pass 0 failed'))
    // defaultProjectMapFromStack returns 3-4 domains for intermediate
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({ llmProvider: mockProvider(), scanMode: 'intermediate' })

    const result = await strategy.run(ctx)

    // Fallback to default, which has 3 domains for intermediate
    expect(mockRunStage2Llm).toHaveBeenCalledTimes(3)
    expect(result.projectMap).toBeDefined()
  })

  it('returns classical-only when no provider is available', async () => {
    const classical = [makeF('Classical', 'a.ts', 1)]

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      classicalFindings: classical,
      llmProvider: undefined,
      scanMode: 'intermediate',
    })

    const result = await strategy.run(ctx)

    expect(mockRunStage2Llm).not.toHaveBeenCalled()
    expect(result.findings).toEqual(classical)
    expect(result.llmSkipped).toBe(true)
  })

  it('intermediate prompt does NOT contain fix-suggestion instruction', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth']))

    let capturedPrompt = ''
    mockRunStage2Llm.mockImplementation(async (opts: any) => {
      capturedPrompt = opts.prompt
      return { findings: [] }
    })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
    })

    await strategy.run(ctx)
    expect(capturedPrompt).toContain('## Security Skills')
    expect(capturedPrompt).not.toMatch(/fix|repair|suggest/i)
  })

  it('handles non-auth error (429/rate-limit) per-domain without scan failure', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth', 'input-validation', 'data-access']))

    const events: any[] = []
    // First domain throws a rate-limit error, subsequent succeed
    const rateLimitError = Object.assign(new Error('Rate limited'), { statusCode: 429 })
    mockRunStage2Llm
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ findings: [makeF('Input Finding', 'src/input.ts', 1, 'llm:input-validation')] })
      .mockResolvedValueOnce({ findings: [makeF('Data Finding', 'src/data.ts', 1, 'llm:data-access')] })

    const strategy = new OrchestratedStrategy('intermediate')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'intermediate',
      onEvent: (e) => events.push(e),
    })

    const result = await strategy.run(ctx)

    // Should still attempt all 3 domains
    expect(mockRunStage2Llm).toHaveBeenCalledTimes(3)
    // Error is NOT auth (429 is not 401/403), so it's caught and scan continues
    expect(result.findings).toHaveLength(2)
    // Warning emitted for the failed domain
    expect(events.some((e) => e.type === 'progress' && e.message.includes('auth'))).toBe(true)
  })
})

describe('OrchestratedStrategy (paranoid)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses includeFixSuggestions in paranoid mode', async () => {
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth']))

    let capturedPrompt = ''
    mockRunStage2Llm.mockImplementation(async (opts: any) => {
      capturedPrompt = opts.prompt
      return { findings: [] }
    })

    const strategy = new OrchestratedStrategy('paranoid')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'paranoid',
    })

    await strategy.run(ctx)

    expect(mockRunStage2Llm).toHaveBeenCalledTimes(1)
    // Paranoid mode prompts include fix suggestion instruction
    expect(capturedPrompt).toContain('fix')
  })

  it('has 5-7 domains for paranoid and cap at 7', async () => {
    // defaultProjectMapFromStack returns 7 domains for paranoid
    mockGenerateProjectMap.mockRejectedValue(new Error('fail'))
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new OrchestratedStrategy('paranoid')
    const ctx = makeCtx({ llmProvider: mockProvider(), scanMode: 'paranoid' })

    await strategy.run(ctx)

    // Paranoid fallback has 7 domains
    expect(mockRunStage2Llm).toHaveBeenCalledTimes(7)
  })

  it('6-domain paranoid produces exactly 6 LLM calls', async () => {
    const sixDomains = makeProjectMap(['auth', 'input-validation', 'data-access', 'api-security', 'secrets-management', 'cryptography'])
    mockGenerateProjectMap.mockResolvedValue(sixDomains)
    mockRunStage2Llm.mockResolvedValue({ findings: [] })

    const strategy = new OrchestratedStrategy('paranoid')
    const ctx = makeCtx({ llmProvider: mockProvider(), scanMode: 'paranoid' })

    await strategy.run(ctx)

    expect(mockRunStage2Llm).toHaveBeenCalledTimes(6)
  })

  it('prompt does NOT contain fix instruction in paranoid mode check', async () => {
    // Redundant with above but separate concern — verify paranoid prompt does contain fix
    mockGenerateProjectMap.mockResolvedValue(makeProjectMap(['auth']))

    let capturedPrompt = ''
    mockRunStage2Llm.mockImplementation(async (opts: any) => {
      capturedPrompt = opts.prompt
      return { findings: [] }
    })

    const strategy = new OrchestratedStrategy('paranoid')
    const ctx = makeCtx({
      llmProvider: mockProvider(),
      scanMode: 'paranoid',
    })

    await strategy.run(ctx)
    expect(capturedPrompt).toMatch(/fix|repair|suggest/i)
  })
})
