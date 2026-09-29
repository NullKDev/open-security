/**
 * tests/integration/pipeline/runner-enrichment.test.ts
 *
 * Tests that runPipeline calls enrichScan after findings are persisted,
 * as a fire-and-forget hook before marking the scan done.
 *
 * Strict TDD: RED → GREEN → REFACTOR
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

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockEnrichScan = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockStrategyRun = vi.hoisted(() => vi.fn())
const mockSelectStrategy = vi.hoisted(() => vi.fn())
const mockNormalizeScanMode = vi.hoisted(() => vi.fn())
const mockCreateProvider = vi.hoisted(() => vi.fn<(stage: string) => unknown>(() => null))

vi.mock('@/lib/enrichment/service', () => ({
  enrichScan: mockEnrichScan,
}))

vi.mock('@/lib/pipeline/strategies', () => ({
  selectStrategy: mockSelectStrategy,
  normalizeScanMode: mockNormalizeScanMode,
}))

vi.mock('@/lib/providers/stage-routing', () => ({
  createProviderForStage: mockCreateProvider,
  buildScanPrompt: vi.fn(() => 'mock prompt'),
}))

vi.mock('@/lib/pipeline/project-map', () => ({
  persistProjectMap: vi.fn().mockResolvedValue(undefined),
}))

import { runPipeline } from '@/lib/pipeline/runner'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obt-enrichment-test-'))
}

function makeSourceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-enrichment-src-'))
  fs.writeFileSync(path.join(dir, 'main.ts'), 'const x = 1\n')
  return dir
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Runner enrichment hook', () => {
  let db: ReturnType<typeof createTestDb>
  let workspace: string
  let sourceDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    db = createTestDb(new Database(':memory:'))
    workspace = makeTmpWorkspace()
    sourceDir = makeSourceDir()

    mockNormalizeScanMode.mockReturnValue('quick')
    mockSelectStrategy.mockReturnValue({
      id: 'quick',
      run: mockStrategyRun.mockResolvedValue({ findings: [], llmSkipped: true }),
    })
  })

  afterEach(() => {
    try { fs.rmSync(workspace, { recursive: true, force: true }) } catch { /* ignore */ }
    try { fs.rmSync(sourceDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('calls enrichScan after findings are persisted', async () => {
    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: sourceDir })
    const scan = createScan(db, { projectId: project.id })
    const bus = createScanBus()

    const handle = runPipeline({
      db,
      scanId: scan.id,
      projectId: project.id,
      sourceKind: 'local',
      sourceRef: sourceDir,
      workspaceRoot: workspace,
      bus,
      scanMode: 'quick',
    })

    await handle.done

    expect(mockEnrichScan).toHaveBeenCalledTimes(1)
    expect(mockEnrichScan).toHaveBeenCalledWith(
      db,
      scan.id,
      expect.any(String), // cacheDir
    )
  })

  it('does NOT block scan completion if enrichScan rejects', async () => {
    mockEnrichScan.mockRejectedValueOnce(new Error('network error'))

    const project = createProject(db, { name: 'test2', sourceKind: 'local', sourceRef: sourceDir })
    const scan = createScan(db, { projectId: project.id })
    const bus = createScanBus()

    const handle = runPipeline({
      db,
      scanId: scan.id,
      projectId: project.id,
      sourceKind: 'local',
      sourceRef: sourceDir,
      workspaceRoot: workspace,
      bus,
      scanMode: 'quick',
    })

    // Should resolve even if enrichScan rejects
    await expect(handle.done).resolves.toBeUndefined()
  })

  it('enrichScan is called with the scanId from the pipeline', async () => {
    const project = createProject(db, { name: 'test3', sourceKind: 'local', sourceRef: sourceDir })
    const scan = createScan(db, { projectId: project.id })
    const bus = createScanBus()

    const handle = runPipeline({
      db,
      scanId: scan.id,
      projectId: project.id,
      sourceKind: 'local',
      sourceRef: sourceDir,
      workspaceRoot: workspace,
      bus,
      scanMode: 'quick',
    })

    await handle.done

    const [, calledScanId] = mockEnrichScan.mock.calls[0]
    expect(calledScanId).toBe(scan.id)
  })
})
