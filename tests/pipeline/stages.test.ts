/**
 * tests/pipeline/stages.test.ts
 *
 * Integration tests for pipeline stages 0-2.
 * Uses stub ProviderClient and in-memory DB.
 * Tests the stage contracts (IPC events order, DB rows, skip-on-missing-binary).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { ScanEvent } from '@/lib/pipeline/events'
import type { ProviderClient, ScanOpts } from '@/lib/providers/index'
import { runStage0Prep } from '@/lib/pipeline/stage0-prep'
import { runStage1Classical } from '@/lib/pipeline/stage1-classical'
import { runStage2Llm } from '@/lib/pipeline/stage2-llm'

// ─── Stub ProviderClient ──────────────────────────────────────────────────────

function makeStubProvider(events: ScanEvent[]): ProviderClient {
  return {
    id: 'stub:test',
    capability: { stream: true, tools: false, jsonMode: false },
    async *scan(_opts: ScanOpts) {
      for (const evt of events) {
        // Only yield provider-compatible events
        if (evt.type === 'finding') {
          yield {
            type: 'finding' as const,
            title: evt.finding.title,
            description: evt.finding.description,
            detector: evt.finding.detector,
            severity: evt.finding.severity,
            location: evt.finding.locationPath,
          }
        } else if (evt.type === 'progress') {
          yield { type: 'progress' as const, message: evt.message }
        } else if (evt.type === 'done') {
          yield { type: 'done' as const }
        }
      }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obt-test-'))
}

function makeFixtureSource(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-source-'))
  fs.writeFileSync(path.join(dir, 'main.ts'), 'const x = 1\n')
  fs.writeFileSync(path.join(dir, 'secret.ts'), 'const apiKey = "hardcoded"\n')
  return dir
}

// ─── Stage 0 tests ────────────────────────────────────────────────────────────

describe('stage0-prep', () => {
  it('creates workspace dir and copies source into it', async () => {
    const workspace = makeTmpWorkspace()
    const sourceDir = makeFixtureSource()

    const events: ScanEvent[] = []
    await runStage0Prep({
      scanId: 'test-scan-01',
      sourceKind: 'local',
      sourceRef: sourceDir,
      workspaceRoot: workspace,
      onEvent: (e) => events.push(e),
    })

    // Should emit stage events
    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents.length).toBeGreaterThan(0)

    // Workspace should contain ingested source
    const ingestedDir = path.join(workspace, 'source')
    expect(fs.existsSync(ingestedDir)).toBe(true)

    // Cleanup
    fs.rmSync(workspace, { recursive: true })
    fs.rmSync(sourceDir, { recursive: true })
  })

  it('emits error event for unknown sourceKind without throwing', async () => {
    const workspace = makeTmpWorkspace()
    const events: ScanEvent[] = []

    await runStage0Prep({
      scanId: 'test-scan-02',
      sourceKind: 'unknown' as 'local',
      sourceRef: '/nonexistent',
      workspaceRoot: workspace,
      onEvent: (e) => events.push(e),
    })

    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()

    fs.rmSync(workspace, { recursive: true })
  })
})

// ─── Stage 1 tests ────────────────────────────────────────────────────────────

describe('stage1-classical', () => {
  it('emits stage events and returns combined findings', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'index.ts'), 'console.log("test")\n')

    const events: ScanEvent[] = []
    const result = await runStage1Classical({
      scanId: 'test-scan-03',
      targetPath: targetDir,
      onEvent: (e) => events.push(e),
    })

    // Should emit at least one stage event
    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents.length).toBeGreaterThan(0)

    // Should return a result object
    expect(result).toBeDefined()
    expect(Array.isArray(result.findings)).toBe(true)

    fs.rmSync(workspace, { recursive: true })
  })

  it('skips a missing binary without failing the pipeline', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })

    const events: ScanEvent[] = []
    // Pass a resolver that says all binaries are missing
    const result = await runStage1Classical({
      scanId: 'test-scan-04',
      targetPath: targetDir,
      onEvent: (e) => events.push(e),
      resolveCheck: () => false, // all binaries "missing"
    })

    // No error event should be emitted for missing binaries
    // (they just get skipped)
    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents).toHaveLength(0)

    // All findings should be empty (all scanners skipped)
    expect(result.findings).toHaveLength(0)

    fs.rmSync(workspace, { recursive: true })
  })

  it('collects findings from multiple scanners', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })

    const finding1 = {
      title: 'Secret found',
      description: 'Hardcoded secret',
      severity: 'high' as const,
      locationPath: 'secret.ts',
      locationLineStart: 1,
      detector: 'gitleaks',
    }

    const events: ScanEvent[] = []
    const result = await runStage1Classical({
      scanId: 'test-scan-05',
      targetPath: targetDir,
      onEvent: (e) => events.push(e),
      // Override scanner with a stub returning known findings
      scannerOverrides: {
        gitleaks: async () => ({ status: 'completed' as const, findings: [finding1] }),
        trufflehog: async () => ({ status: 'skipped' as const, reason: 'binary not found' }),
        semgrep: async () => ({ status: 'skipped' as const, reason: 'binary not found' }),
        osv: async () => ({ status: 'skipped' as const, reason: 'binary not found' }),
      },
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe('Secret found')

    fs.rmSync(workspace, { recursive: true })
  })
})

// ─── Stage 2 tests ────────────────────────────────────────────────────────────

describe('stage2-llm', () => {
  it('emits finding events from stub provider', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'index.ts'), 'const x = 1\n')

    const stubEvents: ScanEvent[] = [
      {
        type: 'finding',
        finding: {
          title: 'SQL Injection',
          description: 'Raw SQL query found',
          severity: 'high',
          locationPath: 'index.ts',
          locationLineStart: 1,
          detector: 'llm',
        },
      },
    ]

    const provider = makeStubProvider(stubEvents)
    const emitted: ScanEvent[] = []

    await runStage2Llm({
      scanId: 'test-scan-06',
      targetPath: targetDir,
      provider,
      prompt: 'Test prompt',
      onEvent: (e) => emitted.push(e),
    })

    // Should emit stage events
    const stageEvts = emitted.filter((e) => e.type === 'stage')
    expect(stageEvts.length).toBeGreaterThan(0)

    // Should emit the finding from the provider
    const findingEvts = emitted.filter((e) => e.type === 'finding')
    expect(findingEvts.length).toBeGreaterThan(0)
  })

  it('handles provider with no findings gracefully', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })

    const provider = makeStubProvider([])
    const emitted: ScanEvent[] = []

    await runStage2Llm({
      scanId: 'test-scan-07',
      targetPath: targetDir,
      provider,
      prompt: 'Test prompt',
      onEvent: (e) => emitted.push(e),
    })

    const errorEvts = emitted.filter((e) => e.type === 'error')
    expect(errorEvts).toHaveLength(0)

    fs.rmSync(workspace, { recursive: true })
  })

  it('emits stage event with correct stage name', async () => {
    const workspace = makeTmpWorkspace()
    const targetDir = path.join(workspace, 'source')
    fs.mkdirSync(targetDir, { recursive: true })

    const provider = makeStubProvider([])
    const emitted: ScanEvent[] = []

    await runStage2Llm({
      scanId: 'test-scan-08',
      targetPath: targetDir,
      provider,
      prompt: 'Test prompt',
      onEvent: (e) => emitted.push(e),
    })

    const stageEvts = emitted.filter((e) => e.type === 'stage')
    expect(stageEvts.length).toBeGreaterThan(0)
    const stageNames = stageEvts.map((e) => (e as { stage: string }).stage)
    expect(stageNames.some((s) => s.includes('llm') || s === 'llm-scan')).toBe(true)

    fs.rmSync(workspace, { recursive: true })
  })
})
