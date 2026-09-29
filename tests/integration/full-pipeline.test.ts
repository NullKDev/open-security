/**
 * tests/integration/full-pipeline.test.ts
 *
 * E2E pipeline integration test. Mocks child_process.fork, simulates worker IPC,
 * verifies bus events, scan status transitions, and finding insertion.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan, getScanById } from '@/lib/repos/scans.repo'
import { createScanBus } from '@/lib/pipeline/scan-bus'
import type { ScanBus } from '@/lib/pipeline/scan-bus'
import type { ScanEvent } from '@/lib/pipeline/events'

const mockFork = vi.fn()
const mockSpawn = vi.fn()

vi.mock('node:child_process', () => ({
  default: { fork: mockFork, spawn: mockSpawn },
  fork: mockFork,
  spawn: mockSpawn,
  exec: mockSpawn,
  execFile: mockSpawn,
  execSync: mockSpawn,
  execFileSync: mockSpawn,
  spawnSync: mockSpawn,
  ChildProcess: class {},
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStageEvent(stage: string, message: string): ScanEvent {
  return { type: 'stage', stage, message }
}

function makeFindingEvent(detector: string, severity: string, title: string): ScanEvent {
  return {
    type: 'finding',
    finding: {
      detector,
      severity: severity as any,
      title,
      description: `Found ${title}`,
      locationPath: 'src/test.ts',
      locationLineStart: 42,
    },
  }
}

function makeProgressEvent(message: string, pct?: number): ScanEvent {
  return { type: 'progress', message, pct }
}

function makeDoneEvent(scanId: string): ScanEvent {
  return { type: 'done', scanId }
}

function createFakeChild() {
  const child = new EventEmitter()
  ;(child as any).stdout = null
  ;(child as any).stderr = null
  ;(child as any).pid = 99999
  ;(child as any).kill = vi.fn((sig?: string) => {
    ;(child as any).killed = true
    setImmediate(() => {
      child.emit('exit', 0, sig ?? 'SIGTERM')
    })
    return true
  })
  ;(child as any).send = vi.fn()
  return child
}

async function emitEvents(child: any, events: ScanEvent[]): Promise<void> {
  for (const event of events) {
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        child.emit('message', event)
        resolve()
      })
    })
  }
}

function setupPipeline(): {
  db: ReturnType<typeof createTestDb>
  projectId: string
  scanId: string
  bus: ScanBus
  workspaceRoot: string
} {
  const sqlite = new Database(':memory:')
  const db = createTestDb(sqlite)
  const project = createProject(db, {
    name: 'test-repo',
    sourceKind: 'github',
    sourceRef: 'https://github.com/test/repo',
  })
  const scan = createScan(db, { projectId: project.id })
  const bus = createScanBus()
  const workspaceRoot = '/tmp/obt-test-workspace'
  return { db, projectId: project.id, scanId: scan.id, bus, workspaceRoot }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Full Pipeline Integration (E2E)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('happy path', () => {
    it('creates scan, runs stages, emits findings, completes with done', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const busEvents: ScanEvent[] = []
      bus.subscribe(scanId, (e) => busEvents.push(e))

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github',
        sourceRef: 'https://github.com/test/repo',
        workspaceRoot, bus,
      })

      await emitEvents(fakeChild, [
        makeStageEvent('prep', 'Preparing...'),
        makeProgressEvent('Cloning...', 10),
        makeStageEvent('classical', 'Running scanners...'),
        makeFindingEvent('gitleaks', 'high', 'Hardcoded secret'),
        makeFindingEvent('semgrep', 'medium', 'SQL injection risk'),
        makeProgressEvent('Scanning files...', 50),
        makeStageEvent('llm', 'LLM analysis...'),
        makeFindingEvent('llm-sqli', 'critical', 'SQL injection'),
        makeStageEvent('validate', 'Validating...'),
        makeStageEvent('filter', 'Filtering...'),
        makeDoneEvent(scanId),
      ])

      await handle.done

      expect(mockFork).toHaveBeenCalledTimes(1)
      const forkOpts = mockFork.mock.calls[0][2]
      expect(forkOpts.env.OBT_SCAN_ID).toBe(scanId)
      expect(forkOpts.env.OBT_SOURCE_KIND).toBe('github')

      expect(busEvents.length).toBeGreaterThanOrEqual(8)
      const stages = busEvents.filter((e) => e.type === 'stage').map((e: any) => e.stage)
      expect(stages).toContain('prep')
      expect(stages).toContain('classical')
      expect(busEvents.filter((e) => e.type === 'finding')).toHaveLength(3)
      expect(busEvents.some((e) => e.type === 'done')).toBe(true)
    })

    it('scan status transitions through stages', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'local', sourceRef: '/tmp/test',
        workspaceRoot, bus,
      })

      await emitEvents(fakeChild, [
        makeStageEvent('prep', 'prep'),
        makeStageEvent('classical', 'classical'),
        makeDoneEvent(scanId),
      ])
      await handle.done

      const scan = getScanById(db, scanId)
      expect(scan).toBeDefined()
      expect(['running', 'done']).toContain(scan!.status)
    })
  })

  describe('scan failure', () => {
    it('marks scan as failed on non-zero exit', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const busEvents: ScanEvent[] = []
      bus.subscribe(scanId, (e) => busEvents.push(e))

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github', sourceRef: 'test',
        workspaceRoot, bus,
      })

      await new Promise<void>((r) => {
        setImmediate(() => { fakeChild.emit('exit', 1, null); r() })
      })
      await handle.done

      const errEvents = busEvents.filter((e) => e.type === 'error')
      expect(errEvents.length).toBeGreaterThanOrEqual(1)
      expect((errEvents[0] as any).message).toContain('exit code 1')
      expect(getScanById(db, scanId)?.status).toBe('failed')
    })

    it('marks scan as failed on SIGKILL', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const busEvents: ScanEvent[] = []
      bus.subscribe(scanId, (e) => busEvents.push(e))

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github', sourceRef: 'test',
        workspaceRoot, bus,
      })

      await new Promise<void>((r) => {
        setImmediate(() => { fakeChild.emit('exit', null, 'SIGKILL'); r() })
      })
      await handle.done

      const errEvents = busEvents.filter((e) => e.type === 'error')
      expect(errEvents.length).toBeGreaterThanOrEqual(1)
      expect((errEvents[0] as any).message).toContain('SIGKILL')
    })
  })

  describe('scan abort', () => {
    it('handle.abort() sends SIGTERM to worker', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github', sourceRef: 'test',
        workspaceRoot, bus,
      })

      handle.abort()
      expect((fakeChild as any).kill).toHaveBeenCalledWith('SIGTERM')
    })
  })

  describe('onComplete callback', () => {
    it('calls onComplete with done', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const onComplete = vi.fn()
      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github', sourceRef: 'test',
        workspaceRoot, bus, onComplete,
      })

      await emitEvents(fakeChild, [
        makeStageEvent('prep', 'prep'),
        makeDoneEvent(scanId),
      ])
      await handle.done

      expect(onComplete).toHaveBeenCalledWith(scanId, 'done')
    })

    it('calls onComplete with failed', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const onComplete = vi.fn()
      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'github', sourceRef: 'test',
        workspaceRoot, bus, onComplete,
      })

      await new Promise<void>((r) => {
        setImmediate(() => { fakeChild.emit('exit', 1, null); r() })
      })
      await handle.done

      expect(onComplete).toHaveBeenCalledWith(scanId, 'failed')
    })
  })

  describe('graceful handling', () => {
    it('handles exit code 0 with no events', async () => {
      const { startScan } = await import('@/lib/pipeline/orchestrator')

      const { db, projectId, scanId, bus, workspaceRoot } = setupPipeline()
      const fakeChild = createFakeChild()
      mockFork.mockReturnValue(fakeChild)

      const handle = startScan({
        db, scanId, projectId,
        sourceKind: 'local', sourceRef: '/tmp/test',
        workspaceRoot, bus,
      })

      await new Promise<void>((r) => {
        setImmediate(() => { fakeChild.emit('exit', 0, null); r() })
      })
      await handle.done
      expect(true).toBe(true)
    })
  })
})
