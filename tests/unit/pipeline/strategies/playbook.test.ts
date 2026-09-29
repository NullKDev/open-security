/**
 * tests/unit/pipeline/strategies/playbook.test.ts
 *
 * Unit tests for PlaybookStrategy — v0.3 named playbook strategy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockDiscoverPlaybooks,
  mockInterpolate,
  mockRunStage2Llm,
} = vi.hoisted(() => ({
  mockDiscoverPlaybooks: vi.fn(),
  mockInterpolate: vi.fn(),
  mockRunStage2Llm: vi.fn(),
}))

vi.mock('@/lib/playbooks/manifest-loader', () => ({
  discoverPlaybooks: mockDiscoverPlaybooks,
}))

vi.mock('@/lib/templates/interpolate', () => ({
  interpolate: mockInterpolate,
}))

vi.mock('@/lib/pipeline/stage2-llm', () => ({
  runStage2Llm: mockRunStage2Llm,
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { PlaybookStrategy } from '@/lib/pipeline/strategies/playbook'
import type { StrategyContext } from '@/lib/pipeline/strategies/types'
import type { Playbook } from '@/lib/playbooks/schema'
import type { NormalizedFinding } from '@/lib/scanners/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'scan-pb-001',
    workspaceRoot: '/tmp/workspace',
    targetPath: '/tmp/repo',
    classicalFindings: [],
    stage0Stack: ['node', 'express'],
    prompt: null,
    scanMode: 'playbook:find-ssrf@1.0.0',
    llmProvider: {
      id: 'test-provider',
      name: 'Test',
      prompt: vi.fn(),
    } as unknown as StrategyContext['llmProvider'],
    onEvent: vi.fn(),
    isAborted: vi.fn().mockReturnValue(false),
    ...overrides,
  }
}

function makePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'find-ssrf',
    name: 'Find SSRF',
    version: '1.0.0',
    promptTemplate: 'Hunt for SSRF in {{targetPath}} for {{cveId}}',
    source: 'builtin',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaybookStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Constructor / id
  // -------------------------------------------------------------------------
  it('has id matching the playbook:name@version pattern', () => {
    mockDiscoverPlaybooks.mockResolvedValue([makePlaybook()])
    const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
    expect(strategy.id).toBe('playbook:find-ssrf@1.0.0')
  })

  // -------------------------------------------------------------------------
  // Playbook loading: correct playbook loaded by name@version
  // -------------------------------------------------------------------------
  describe('run() — playbook loading', () => {
    it('calls discoverPlaybooks with the workspaceRoot and loads matching playbook', async () => {
      const playbook = makePlaybook({ id: 'find-ssrf', version: '1.0.0' })
      mockDiscoverPlaybooks.mockResolvedValue([playbook])
      mockInterpolate.mockReturnValue('interpolated prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      const ctx = makeCtx()
      await strategy.run(ctx)

      expect(mockDiscoverPlaybooks).toHaveBeenCalledWith(ctx.workspaceRoot)
    })

    it('loads the playbook matching name AND version', async () => {
      const playbookV1 = makePlaybook({ id: 'find-ssrf', version: '1.0.0', promptTemplate: 'v1 template' })
      const playbookV2 = makePlaybook({ id: 'find-ssrf', version: '2.0.0', promptTemplate: 'v2 template' })
      mockDiscoverPlaybooks.mockResolvedValue([playbookV1, playbookV2])
      mockInterpolate.mockReturnValue('rendered v1')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      await strategy.run(makeCtx())

      // interpolate should be called with v1's template (not v2)
      expect(mockInterpolate).toHaveBeenCalledWith('v1 template', expect.any(Object))
    })
  })

  // -------------------------------------------------------------------------
  // Prompt interpolation: scan context vars injected
  // -------------------------------------------------------------------------
  describe('run() — prompt interpolation', () => {
    it('interpolates the prompt template with scan context variables', async () => {
      const playbook = makePlaybook({ promptTemplate: 'Scan {{targetPath}} with stack {{stack}}' })
      mockDiscoverPlaybooks.mockResolvedValue([playbook])
      mockInterpolate.mockReturnValue('rendered prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const ctx = makeCtx({ targetPath: '/my/repo', stage0Stack: ['django', 'python'] })
      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      await strategy.run(ctx)

      expect(mockInterpolate).toHaveBeenCalledWith(
        'Scan {{targetPath}} with stack {{stack}}',
        expect.objectContaining({
          targetPath: '/my/repo',
          stack: expect.stringContaining('django') as string,
        }),
      )
    })

    it('passes the interpolated prompt to runStage2Llm', async () => {
      const playbook = makePlaybook()
      mockDiscoverPlaybooks.mockResolvedValue([playbook])
      mockInterpolate.mockReturnValue('RENDERED PLAYBOOK PROMPT')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      await strategy.run(makeCtx())

      expect(mockRunStage2Llm).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'RENDERED PLAYBOOK PROMPT' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Unknown playbook → emits error event + falls back to standard
  // -------------------------------------------------------------------------
  describe('run() — unknown playbook fallback', () => {
    it('emits a progress event with error and still runs (llmSkipped:false)', async () => {
      // Return empty list — playbook not found
      mockDiscoverPlaybooks.mockResolvedValue([])
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const ctx = makeCtx()
      const strategy = new PlaybookStrategy('nonexistent@9.9.9')
      const result = await strategy.run(ctx)

      // Should emit a progress event about the missing playbook
      expect(ctx.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'progress', message: expect.stringContaining('nonexistent@9.9.9') as string }),
      )

      // Still runs (not blocked)
      expect(result).toBeDefined()
    })

    it('falls back to stage2 with standard prompt when playbook not found', async () => {
      mockDiscoverPlaybooks.mockResolvedValue([])
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new PlaybookStrategy('nonexistent@9.9.9')
      await strategy.run(makeCtx())

      // runStage2Llm should still be called (fallback)
      expect(mockRunStage2Llm).toHaveBeenCalledOnce()
      // interpolate should NOT be called (no template available)
      expect(mockInterpolate).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Parameter defaults applied
  // -------------------------------------------------------------------------
  describe('run() — parameter defaults', () => {
    it('merges playbook parameters into the interpolation vars', async () => {
      const playbook = makePlaybook({
        parameters: { depth: 'deep', focus: 'authentication' },
      })
      mockDiscoverPlaybooks.mockResolvedValue([playbook])
      mockInterpolate.mockReturnValue('rendered with defaults')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      await strategy.run(makeCtx())

      expect(mockInterpolate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ depth: 'deep', focus: 'authentication' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // No LLM provider → skip
  // -------------------------------------------------------------------------
  describe('run() — no LLM provider', () => {
    it('returns llmSkipped:true with classicalFindings when no provider', async () => {
      const classicalFinding = { id: 'f-1' } as unknown as NormalizedFinding
      const ctx = makeCtx({
        llmProvider: undefined,
        classicalFindings: [classicalFinding],
      })

      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      const result = await strategy.run(ctx)

      expect(result.llmSkipped).toBe(true)
      expect(result.findings).toHaveLength(1)
      expect(mockDiscoverPlaybooks).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Result merging
  // -------------------------------------------------------------------------
  describe('run() — result merging', () => {
    it('merges classical findings with LLM findings from playbook', async () => {
      const classical = { id: 'c-1' } as unknown as NormalizedFinding
      const llmFinding = { id: 'l-1' } as unknown as NormalizedFinding

      mockDiscoverPlaybooks.mockResolvedValue([makePlaybook()])
      mockInterpolate.mockReturnValue('prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [llmFinding] })

      const ctx = makeCtx({ classicalFindings: [classical] })
      const strategy = new PlaybookStrategy('find-ssrf@1.0.0')
      const result = await strategy.run(ctx)

      expect(result.findings).toHaveLength(2)
      const ids = result.findings.map((f) => f.id)
      expect(ids).toContain('c-1')
      expect(ids).toContain('l-1')
    })
  })
})
