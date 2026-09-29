/**
 * tests/integration/pipeline/runner.test.ts
 *
 * Integration tests for Phase 4 runner integration — strategy-based mode dispatch.
 * Tests that runPipeline delegates to selectStrategy/normalizeScanMode,
 * handles llmSkipped correctly, and persists projectMap when present.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { createScanBus } from '@/lib/pipeline/scan-bus'
import type { ScanEvent } from '@/lib/pipeline/events'

// ─── Mock setup (before any imports that use these modules) ──────────────────

const mockStrategyRun = vi.hoisted(() => vi.fn())
const mockSelectStrategy = vi.hoisted(() => vi.fn())
const mockNormalizeScanMode = vi.hoisted(() => vi.fn())
const mockCreateProvider = vi.hoisted(() => vi.fn<(stage: string) => unknown>(() => null))
const mockPersistProjectMap = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRunRegressionDetect = vi.hoisted(() => vi.fn().mockReturnValue(0))
const mockRefreshPosture = vi.hoisted(() => vi.fn().mockReturnValue({
  id: 'snap-1', projectId: 'p1', bucketDate: '2024-01-01',
  countCritical: 0, countHigh: 0, countMedium: 0, countLow: 0, countInfo: 0,
  weightedScore: 0, openCriticalDays: 0, snapshotAt: new Date().toISOString(), scanId: null,
}))

vi.mock('@/lib/pipeline/strategies', () => ({
  selectStrategy: mockSelectStrategy,
  normalizeScanMode: mockNormalizeScanMode,
}))

vi.mock('@/lib/providers/stage-routing', () => ({
  createProviderForStage: mockCreateProvider,
  buildScanPrompt: vi.fn(() => 'Mock scan prompt'),
}))

vi.mock('@/lib/pipeline/project-map', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pipeline/project-map')>('@/lib/pipeline/project-map')
  return {
    ...actual,
    persistProjectMap: mockPersistProjectMap,
  }
})

vi.mock('@/lib/dedup/post-hooks/regression-detect', () => ({
  runRegressionDetect: mockRunRegressionDetect,
}))

vi.mock('@/lib/posture/refresh', () => ({
  refreshPosture: mockRefreshPosture,
}))

// Import runner after mocks are set up
import { runPipeline } from '@/lib/pipeline/runner'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obt-runner-test-'))
}

function makeSourceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-source-'))
  fs.writeFileSync(path.join(dir, 'main.ts'), 'const x = 1\n')
  fs.writeFileSync(path.join(dir, 'secret.ts'), 'const apiKey = "hardcoded"\n')
  return dir
}

function collectEvents(bus: ReturnType<typeof createScanBus>, scanId: string): ScanEvent[] {
  const collected: ScanEvent[] = []
  bus.subscribe(scanId, (e) => collected.push(e))
  return collected
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Runner strategy dispatch (Phase 4)', () => {
  let db: ReturnType<typeof createTestDb>
  let workspace: string
  let sourceDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    db = createTestDb(new Database(':memory:'))
    workspace = makeTmpWorkspace()
    sourceDir = makeSourceDir()
  })

  afterEach(() => {
    try { fs.rmSync(workspace, { recursive: true, force: true }) } catch { /* ignore */ }
    try { fs.rmSync(sourceDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  describe('Strategy dispatch', () => {
    it('calls normalizeScanMode with the raw scanMode on every pipeline run', async () => {
      mockNormalizeScanMode.mockReturnValue('quick')
      mockSelectStrategy.mockReturnValue({
        id: 'quick',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'quick' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'quick',
      })

      await handle.done

      // RED: current runner does NOT call normalizeScanMode — this assertion will fail
      expect(mockNormalizeScanMode).toHaveBeenCalledWith(
        'quick',
        expect.any(Function),
      )
    })

    it('delegates to selectStrategy with the normalized mode', async () => {
      const NORMALIZED = 'standard'
      mockNormalizeScanMode.mockReturnValue(NORMALIZED)
      mockSelectStrategy.mockReturnValue({
        id: NORMALIZED,
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test2', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // RED: current runner does NOT call selectStrategy
      expect(mockSelectStrategy).toHaveBeenCalledWith(NORMALIZED)
    })

    it('calls strategy.run() with a valid StrategyContext', async () => {
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test3', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // RED: current runner does NOT call strategy.run()
      expect(mockStrategyRun).toHaveBeenCalledTimes(1)

      // Verify the context shape
      const ctxArg = mockStrategyRun.mock.calls[0][0]
      expect(ctxArg).toMatchObject({
        scanId: scan.id,
        workspaceRoot: workspace,
        targetPath: `${workspace}/source`,
        scanMode: 'standard',
        llmProvider: null, // our mock provider returns null
      })
      expect(Array.isArray(ctxArg.classicalFindings)).toBe(true)
      expect(Array.isArray(ctxArg.stage0Stack)).toBe(true)
      expect(typeof ctxArg.onEvent).toBe('function')
      expect(typeof ctxArg.isAborted).toBe('function')
    })
  })

  describe('llmSkipped flow', () => {
    it('quick mode skips LLM stages 3 and 5 when strategy returns llmSkipped: true', async () => {
      mockNormalizeScanMode.mockReturnValue('quick')
      mockSelectStrategy.mockReturnValue({
        id: 'quick',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test4', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'quick' })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'quick',
      })

      await handle.done

      // Quick mode should NOT emit validate or patch stage events
      const stageNames = events
        .filter((e) => e.type === 'stage')
        .map((e: any) => e.stage)

      expect(stageNames).not.toContain('validate')
      expect(stageNames).not.toContain('patch')
      expect(stageNames).toContain('classical')
    })

    it('standard mode runs stage 3 validate when strategy returns llmSkipped: false', async () => {
      // This test needs a provider that actually works through stage3.
      // Override mockCreateProvider to return a stub for 'llm-scan', 'validate', and 'patch'
      const stubProvider = {
        id: 'stub',
        capability: { stream: true, tools: false, jsonMode: false },
        async *scan() { yield { type: 'done' as const } },
      }
      mockCreateProvider.mockImplementation((stage: string) => {
        if (stage === 'llm-scan') return stubProvider
        if (stage === 'validate') return stubProvider
        if (stage === 'patch') return stubProvider
        return null
      })

      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: false }),
      })

      const project = createProject(db, { name: 'test5', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      const stageNames = events
        .filter((e) => e.type === 'stage')
        .map((e: any) => e.stage)

      expect(stageNames).toContain('validate')
    })
  })

  describe('Unknown mode fallback', () => {
    it('normalizes unknown scanMode to standard and emits warning', async () => {
      let capturedWarn = ''
      mockNormalizeScanMode.mockImplementation((raw: string, onWarn?: (msg: string) => void) => {
        onWarn?.('Unknown scanMode \'garbage\', falling back to \'standard\'')
        capturedWarn = 'Unknown scanMode \'garbage\', falling back to \'standard\''
        return 'standard'
      })

      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test6', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'garbage' as any })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus,
        scanMode: 'garbage' as any,
      })

      await handle.done

      // Should call normalizeScanMode with the raw value
      expect(mockNormalizeScanMode).toHaveBeenCalledWith('garbage', expect.any(Function))

      // normalizeScanMode should have emitted a warning (via onWarn callback)
      expect(capturedWarn).toContain('Unknown')

      // Should delegate to selectStrategy with 'standard'
      expect(mockSelectStrategy).toHaveBeenCalledWith('standard')

      // Check that a progress/warning event was published
      const progressEvents = events.filter((e) => e.type === 'progress')
      const hasUnknownWarning = progressEvents.some(
        (e: any) => e.message?.includes('Unknown') || e.message?.includes('garbage'),
      )
      expect(hasUnknownWarning).toBe(true)
    })
  })

  describe('Legacy mode handling', () => {
    it('maps legacy "deep" to "paranoid" via normalizeScanMode', async () => {
      mockNormalizeScanMode.mockImplementation((raw: string, onWarn?: (msg: string) => void) => {
        if (raw === 'deep') {
          onWarn?.('Legacy \'deep\' mode received; mapping to \'paranoid\'')
          return 'paranoid'
        }
        return 'standard'
      })

      mockSelectStrategy.mockReturnValue({
        id: 'paranoid',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test-legacy', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'deep' as any })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus,
        scanMode: 'deep' as any,
      })

      await handle.done

      expect(mockNormalizeScanMode).toHaveBeenCalledWith('deep', expect.any(Function))
      expect(mockSelectStrategy).toHaveBeenCalledWith('paranoid')

      // Warning should have been published
      const progressEvents = events.filter((e) => e.type === 'progress')
      const deepWarning = progressEvents.some(
        (e: any) => e.message?.includes('deep'),
      )
      expect(deepWarning).toBe(true)
    })
  })

  describe('No LLM provider', () => {
    it('skips LLM stages when createProviderForStage returns null', async () => {
      mockCreateProvider.mockReturnValue(null)
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test-noprovider', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // No LLM provider → should NOT emit validate or patch stages
      const stageNames = events
        .filter((e) => e.type === 'stage')
        .map((e: any) => e.stage)

      expect(stageNames).not.toContain('validate')
      expect(stageNames).not.toContain('patch')
    })
  })

  describe('ProjectMap persistence', () => {
    it('calls persistProjectMap when strategy result includes projectMap', async () => {
      mockNormalizeScanMode.mockReturnValue('intermediate')
      mockSelectStrategy.mockReturnValue({
        id: 'intermediate',
        run: mockStrategyRun.mockResolvedValue({
          findings: [],
          llmSkipped: true,
          projectMap: {
            stack: ['typescript'],
            frameworks: ['next.js'],
            entryPoints: ['src/app/page.tsx'],
            attackSurface: ['http-api'],
            domains: ['auth', 'input-validation', 'data-access'],
            relevantSkillIds: ['next-best-practices'],
          },
        }),
      })

      const project = createProject(db, { name: 'test7', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'intermediate' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus,
        scanMode: 'intermediate',
      })

      await handle.done

      // RED: current runner does NOT call persistProjectMap
      expect(mockPersistProjectMap).toHaveBeenCalledTimes(1)
      expect(mockPersistProjectMap).toHaveBeenCalledWith(
        db,
        scan.id,
        workspace,
        expect.objectContaining({ domains: ['auth', 'input-validation', 'data-access'] }),
      )
    })

    it('does NOT call persistProjectMap when strategy result has no projectMap', async () => {
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'test8', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // persistProjectMap should NOT have been called (no projectMap in result)
      expect(mockPersistProjectMap).not.toHaveBeenCalled()
    })
  })

  describe('Post-scan hook chain (T-029)', () => {
    it('calls runRegressionDetect after scan completes', async () => {
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'hooks-test-1', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // RED: runner does not call runRegressionDetect yet
      expect(mockRunRegressionDetect).toHaveBeenCalledWith(db, scan.id)
    })

    it('calls refreshPosture after regression detection', async () => {
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'hooks-test-2', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // RED: runner does not call refreshPosture yet
      expect(mockRefreshPosture).toHaveBeenCalledWith(db, project.id, scan.id)
    })

    it('hook chain does not block scan completion — done event fires', async () => {
      mockNormalizeScanMode.mockReturnValue('quick')
      mockSelectStrategy.mockReturnValue({
        id: 'quick',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })

      const project = createProject(db, { name: 'hooks-test-3', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'quick' })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'quick',
      })

      await handle.done

      // Scan must still complete with a 'done' event even when hooks are wired
      const doneEvents = events.filter((e) => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
    })

    it('hook chain errors do not fail the scan', async () => {
      mockNormalizeScanMode.mockReturnValue('standard')
      mockSelectStrategy.mockReturnValue({
        id: 'standard',
        run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
      })
      // Force regression detect to throw
      mockRunRegressionDetect.mockImplementationOnce(() => { throw new Error('hook error') })

      const project = createProject(db, { name: 'hooks-test-err', sourceKind: 'local', sourceRef: sourceDir })
      const scan = createScan(db, { projectId: project.id, scanMode: 'standard' })
      const bus = createScanBus()
      const events = collectEvents(bus, scan.id)

      const handle = runPipeline({
        db, scanId: scan.id, projectId: project.id,
        sourceKind: 'local', sourceRef: sourceDir,
        workspaceRoot: workspace, bus, scanMode: 'standard',
      })

      await handle.done

      // Scan must still complete despite hook error
      const doneEvents = events.filter((e) => e.type === 'done')
      expect(doneEvents).toHaveLength(1)
    })
  })
})
