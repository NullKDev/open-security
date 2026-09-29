/**
 * tests/unit/pipeline/strategies/hunt.test.ts
 *
 * Unit tests for HuntStrategy — v0.3 CVE hunt strategy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockFetchAdvisory,
  mockClassifyAdvisory,
  mockBuildHuntPrompt,
  mockRunStage2Llm,
  mockUpsertHuntTarget,
  mockGetDb,
} = vi.hoisted(() => ({
  mockFetchAdvisory: vi.fn(),
  mockClassifyAdvisory: vi.fn(),
  mockBuildHuntPrompt: vi.fn(),
  mockRunStage2Llm: vi.fn(),
  mockUpsertHuntTarget: vi.fn(),
  mockGetDb: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/advisories/osv-client', () => ({
  fetchAdvisory: mockFetchAdvisory,
}))

vi.mock('@/lib/advisories/cve-class', () => ({
  classifyAdvisory: mockClassifyAdvisory,
}))

vi.mock('@/lib/hunt/hunt-context', () => ({
  buildHuntPrompt: mockBuildHuntPrompt,
}))

vi.mock('@/lib/pipeline/stage2-llm', () => ({
  runStage2Llm: mockRunStage2Llm,
}))

vi.mock('@/lib/repos/hunt-targets.repo', () => ({
  upsertHuntTarget: mockUpsertHuntTarget,
}))

vi.mock('@/lib/db/client', () => ({
  getDb: mockGetDb,
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { HuntStrategy } from '@/lib/pipeline/strategies/hunt'
import type { StrategyContext } from '@/lib/pipeline/strategies/types'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { AdvisoryMeta } from '@/lib/advisories/osv-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    scanId: 'scan-hunt-001',
    workspaceRoot: '/tmp/workspace',
    targetPath: '/tmp/repo',
    classicalFindings: [],
    stage0Stack: ['node', 'express'],
    prompt: 'CVE-2024-1234',
    scanMode: 'hunt',
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

const mockAdvisory: AdvisoryMeta = {
  id: 'CVE-2024-1234',
  summary: 'SQL Injection in foo library',
  details: 'Detailed description',
  cwes: ['CWE-89'],
  packageName: 'foo',
  packageEcosystem: 'npm',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HuntStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Constructor / id
  // -------------------------------------------------------------------------
  it('has id === "hunt"', () => {
    const strategy = new HuntStrategy('CVE-2024-1234')
    expect(strategy.id).toBe('hunt')
  })

  // -------------------------------------------------------------------------
  // preStage0: fetchAdvisory called with cveId, result cached on strategy
  // -------------------------------------------------------------------------
  describe('run() — advisory fetch', () => {
    it('calls fetchAdvisory with the cveId extracted from prompt', async () => {
      const ctx = makeCtx({ prompt: 'CVE-2024-1234' })
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('hunt prompt text')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      expect(mockFetchAdvisory).toHaveBeenCalledWith('CVE-2024-1234')
    })

    it('calls fetchAdvisory once even when cveId is explicit constructor arg', async () => {
      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('hunt prompt text')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      expect(mockFetchAdvisory).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // stage2: buildHuntPrompt used for LLM prompt
  // -------------------------------------------------------------------------
  describe('run() — prompt generation', () => {
    it('calls classifyAdvisory + buildHuntPrompt with advisory data', async () => {
      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('hunt prompt text')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      expect(mockClassifyAdvisory).toHaveBeenCalledWith(mockAdvisory)
      expect(mockBuildHuntPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          cveId: 'CVE-2024-1234',
          cveClass: 'injection',
          targetPath: ctx.targetPath,
        }),
      )
    })

    it('passes the buildHuntPrompt result as prompt to runStage2Llm', async () => {
      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('HUNT PROMPT')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      expect(mockRunStage2Llm).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'HUNT PROMPT' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // postStage2: verdict stored via huntTargetsRepo.upsert
  // -------------------------------------------------------------------------
  describe('run() — verdict storage', () => {
    it('calls upsertHuntTarget with scanId and finding data after stage2', async () => {
      const finding: NormalizedFinding = {
        id: 'f-1',
        detector: 'llm:hunt',
        severity: 'HIGH',
        confidence: 0.9,
        title: 'SQL Injection found',
        description: 'found',
        location: { path: 'src/db.js', startLine: 10 },
      } as unknown as NormalizedFinding

      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('hunt prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [finding] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      expect(mockUpsertHuntTarget).toHaveBeenCalledOnce()
      const [, scanId, input] = mockUpsertHuntTarget.mock.calls[0]
      expect(scanId).toBe('scan-hunt-001')
      expect(input).toMatchObject({
        cveId: 'CVE-2024-1234',
        targetPath: ctx.targetPath,
      })
    })
  })

  // -------------------------------------------------------------------------
  // OSV 404 → fallback to generic hunt with null advisory
  // -------------------------------------------------------------------------
  describe('run() — OSV 404 fallback', () => {
    it('falls back to generic hunt prompt when advisory returns null', async () => {
      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(null)
      mockBuildHuntPrompt.mockReturnValue('generic hunt prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      await strategy.run(ctx)

      // classifyAdvisory should NOT be called (null advisory → no classification)
      expect(mockClassifyAdvisory).not.toHaveBeenCalled()
      // buildHuntPrompt should still be called with cveClass 'generic'
      expect(mockBuildHuntPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          cveId: 'CVE-2024-1234',
          cveClass: 'generic',
        }),
      )
    })

    it('returns llmSkipped:false even with null advisory when provider available', async () => {
      const ctx = makeCtx()
      mockFetchAdvisory.mockResolvedValue(null)
      mockBuildHuntPrompt.mockReturnValue('generic hunt prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      const result = await strategy.run(ctx)

      expect(result.llmSkipped).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // No LLM provider → skip
  // -------------------------------------------------------------------------
  describe('run() — no LLM provider', () => {
    it('returns llmSkipped:true and classicalFindings when no provider', async () => {
      const classicalFinding = {
        id: 'f-classical',
        detector: 'gitleaks',
        severity: 'HIGH',
      } as unknown as NormalizedFinding

      const ctx = makeCtx({
        llmProvider: undefined,
        classicalFindings: [classicalFinding],
      })

      const strategy = new HuntStrategy('CVE-2024-1234')
      const result = await strategy.run(ctx)

      expect(result.llmSkipped).toBe(true)
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].id).toBe('f-classical')
      expect(mockFetchAdvisory).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Result merging
  // -------------------------------------------------------------------------
  describe('run() — result merging', () => {
    it('merges classical findings with LLM findings', async () => {
      const classical = { id: 'f-c1', detector: 'gitleaks' } as unknown as NormalizedFinding
      const llmFinding = { id: 'f-l1', detector: 'llm:hunt' } as unknown as NormalizedFinding

      const ctx = makeCtx({ classicalFindings: [classical] })
      mockFetchAdvisory.mockResolvedValue(mockAdvisory)
      mockClassifyAdvisory.mockReturnValue('injection')
      mockBuildHuntPrompt.mockReturnValue('prompt')
      mockRunStage2Llm.mockResolvedValue({ findings: [llmFinding] })

      const strategy = new HuntStrategy('CVE-2024-1234')
      const result = await strategy.run(ctx)

      expect(result.findings).toHaveLength(2)
      expect(result.findings.map((f) => f.id)).toContain('f-c1')
      expect(result.findings.map((f) => f.id)).toContain('f-l1')
    })
  })
})
