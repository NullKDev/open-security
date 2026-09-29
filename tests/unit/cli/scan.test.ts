/**
 * tests/unit/cli/scan.test.ts
 *
 * Tests for `bin/obt.ts` — the headless CLI entry point.
 * Commander-based CLI with 4 commands: scan, history, report, agents.
 *
 * Patterns:
 * - vi.mock hoisted mocks for all lib dependencies
 * - vi.hoisted() for mock variables (vitest hoists factories above init)
 * - Import program from bin/obt.ts
 * - Test each command dispatches to the right lib function
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// ── Mock state variables (hoisted so vi.mock factories can reference them) ──

const {
  mockGetDb,
  mockCreateProject,
  mockCreateScan,
  mockStartScan,
  mockSubscribe,
  mockPublish,
  mockWalkHistory,
  mockGenerateJsonReport,
  mockGenerateCsvReport,
  mockGenerateSarifReport,
  mockRenderReport,
  mockResolveOnPath,
  mockConsoleLog,
  mockConsoleError,
} = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCreateScan: vi.fn(),
  mockStartScan: vi.fn(),
  mockSubscribe: vi.fn(),
  mockPublish: vi.fn(),
  mockWalkHistory: vi.fn(),
  mockGenerateJsonReport: vi.fn(),
  mockGenerateCsvReport: vi.fn(),
  mockGenerateSarifReport: vi.fn(),
  mockRenderReport: vi.fn(),
  mockResolveOnPath: vi.fn(),
  mockConsoleLog: vi.fn(),
  mockConsoleError: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: mockGetDb,
}))

vi.mock('@/lib/repos/projects.repo', () => ({
  createProject: mockCreateProject,
}))

vi.mock('@/lib/repos/scans.repo', () => ({
  createScan: mockCreateScan,
}))

vi.mock('@/lib/pipeline/orchestrator', () => ({
  startScan: mockStartScan,
}))

vi.mock('@/lib/git/history-walker', () => ({
  walkHistory: mockWalkHistory,
}))

vi.mock('@/lib/reports/json', () => ({
  generateJsonReport: mockGenerateJsonReport,
}))

vi.mock('@/lib/reports/csv', () => ({
  generateCsvReport: mockGenerateCsvReport,
}))

vi.mock('@/lib/reports/sarif', () => ({
  generateSarifReport: mockGenerateSarifReport,
}))

vi.mock('@/lib/reports/md', () => ({
  renderReport: mockRenderReport,
}))

vi.mock('@/lib/providers/cli/resolve', () => ({
  resolveOnPath: mockResolveOnPath,
}))

vi.mock('@/lib/providers/cli/agents', () => ({
  AGENT_DEFS: [
    { id: 'claude', bin: 'claude', probeArgs: ['--version'], streamFormat: 'claude-stream-json', buildArgs: () => [] },
    { id: 'codex', bin: 'codex', probeArgs: ['--version'], streamFormat: 'json-event-stream', buildArgs: () => [] },
    { id: 'gemini', bin: 'gemini', probeArgs: ['--version'], streamFormat: 'json-event-stream', buildArgs: () => [] },
  ],
}))

// RED: this import fails because bin/obt.ts does not exist yet
import { createProgram } from '@/bin/obt'

// ── Test suite ──

describe('obt CLI', () => {
  let program: ReturnType<typeof createProgram>

  beforeEach(() => {
    vi.clearAllMocks()

    // Silence console during tests
    vi.spyOn(console, 'log').mockImplementation(mockConsoleLog)
    vi.spyOn(console, 'error').mockImplementation(mockConsoleError)

    // Default DB mock — returns a valid scan row for report tests
    const mockScanRow = {
      id: 'scan-1',
      projectId: 'proj-1',
      status: 'done',
      stage: 'done',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      modelsUsed: null,
      error: null,
    }
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue(mockScanRow),
      all: vi.fn().mockReturnValue([]),
    }
    mockGetDb.mockReturnValue(mockDb)

    // Default project/scan mocks
    mockCreateProject.mockReturnValue({
      id: 'proj-1',
      name: 'test-repo',
      sourceKind: 'github',
      sourceRef: 'https://github.com/test/repo',
      createdAt: new Date().toISOString(),
    })
    mockCreateScan.mockReturnValue({
      id: 'scan-1',
      projectId: 'proj-1',
      status: 'pending',
      stage: null,
      startedAt: null,
      finishedAt: null,
      modelsUsed: null,
      error: null,
    })

    // Default orchestrator mock
    const emitter = new EventEmitter()
    const bus = {
      subscribe: mockSubscribe.mockImplementation((_scanId: string, fn: (ev: unknown) => void) => {
        emitter.on('event', fn)
        return () => emitter.off('event', fn)
      }),
      publish: mockPublish.mockImplementation((_scanId: string, ev: unknown) => {
        emitter.emit('event', ev)
      }),
      replay: vi.fn().mockReturnValue([]),
      destroy: vi.fn(),
    }
    mockStartScan.mockReturnValue({
      bus,
      done: Promise.resolve(),
      abort: vi.fn(),
    })

    program = createProgram()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── scan command ──

  describe('scan <source>', () => {
    it('detects github source, creates project + scan, and starts pipeline', async () => {
      await program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo'])

      expect(mockCreateProject).toHaveBeenCalledTimes(1)
      const projectCall = mockCreateProject.mock.calls[0]
      expect(projectCall[1].sourceKind).toBe('github')
      expect(projectCall[1].sourceRef).toBe('https://github.com/org/repo')
      expect(projectCall[1].name).toBe('repo')

      expect(mockCreateScan).toHaveBeenCalledTimes(1)
      expect(mockCreateScan.mock.calls[0][1].projectId).toBe('proj-1')

      expect(mockStartScan).toHaveBeenCalledTimes(1)
      const startCall = mockStartScan.mock.calls[0][0]
      expect(startCall.scanId).toBe('scan-1')
      expect(startCall.sourceKind).toBe('github')
    })

    it('detects gitlab URLs', async () => {
      await program.parseAsync(['node', 'obt', 'scan', 'https://gitlab.com/group/repo'])

      const projectCall = mockCreateProject.mock.calls[0]
      expect(projectCall[1].sourceKind).toBe('gitlab')
      expect(projectCall[1].sourceRef).toBe('https://gitlab.com/group/repo')
    })

    it('detects local path sources', async () => {
      await program.parseAsync(['node', 'obt', 'scan', '/home/user/project'])

      const projectCall = mockCreateProject.mock.calls[0]
      expect(projectCall[1].sourceKind).toBe('local')
      // sourceRef is resolved absolute path
      expect(projectCall[1].sourceRef).toContain('/home/user/project')
    })

    it('detects zip file sources by .zip extension', async () => {
      await program.parseAsync(['node', 'obt', 'scan', '/tmp/repo.zip'])

      const projectCall = mockCreateProject.mock.calls[0]
      expect(projectCall[1].sourceKind).toBe('zip')
    })

    it('strips .git suffix from project name', async () => {
      await program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo.git'])

      expect(mockCreateProject.mock.calls[0][1].name).toBe('repo')
    })

    it('prints scan ID on start', async () => {
      await program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo'])

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('scan-1'))
    })

    it('streams stage progress events to stdout', async () => {
      const donePromise = program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo'])

      // Simulate pipeline events
      mockPublish('scan-1', { type: 'stage', stage: 'classical', message: 'Running gitleaks' })
      mockPublish('scan-1', { type: 'finding', finding: { title: 'Hardcoded secret', severity: 'high', detector: 'gitleaks', locationPath: 'src/config.ts', locationLineStart: 5 } })
      mockPublish('scan-1', { type: 'done', scanId: 'scan-1' })

      await donePromise

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('[classical]'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Hardcoded secret'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Scan complete'))
    })

    it('prints errors to stderr', async () => {
      const donePromise = program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo'])

      mockPublish('scan-1', { type: 'error', message: 'Tool not found: gitleaks' })

      await donePromise

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Tool not found'))
    })

    it('calls abort on SIGTERM', async () => {
      const mockAbort = vi.fn()
      mockStartScan.mockReturnValueOnce({
        bus: {
          subscribe: mockSubscribe.mockImplementation(() => () => {}),
          publish: vi.fn(),
          replay: vi.fn(),
          destroy: vi.fn(),
        },
        done: new Promise<void>(() => {}), // never resolves
        abort: mockAbort,
      })

      const parsePromise = program.parseAsync(['node', 'obt', 'scan', 'https://github.com/org/repo'])

      // Wait a tick for the action handler to register the SIGTERM listener
      await new Promise((r) => setTimeout(r, 10))
      process.emit('SIGTERM' as never, 'SIGTERM')

      expect(mockAbort).toHaveBeenCalled()
      parsePromise.catch(() => {}) // prevent unhandled rejection on timeout
    })
  })

  // ── history command ──

  describe('history <path>', () => {
    it('walks git history and outputs commit records as JSON', async () => {
      const mockCommits = [
        { hash: 'abc123', message: 'fix: leak', author: 'dev', authorEmail: 'dev@test.com', date: '2025-01-01', filesChanged: 2, insertions: 10, deletions: 3 },
        { hash: 'def456', message: 'feat: add auth', author: 'dev2', authorEmail: 'dev2@test.com', date: '2025-01-02', filesChanged: 5, insertions: 50, deletions: 0 },
      ]

      mockWalkHistory.mockReturnValue((async function* () {
        for (const c of mockCommits) yield c
      })())

      await program.parseAsync(['node', 'obt', 'history', '/path/to/repo'])

      expect(mockWalkHistory).toHaveBeenCalledTimes(1)
      const walkPath = mockWalkHistory.mock.calls[0][0]
      expect(walkPath).toContain('/path/to/repo')

      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(mockCommits[0]))
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(mockCommits[1]))
    })

    it('outputs nothing for empty repo history', async () => {
      mockWalkHistory.mockReturnValue((async function* () {
        // No yields — empty repo
      })())

      await program.parseAsync(['node', 'obt', 'history', '/path/to/empty'])

      expect(mockWalkHistory).toHaveBeenCalledTimes(1)
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })
  })

  // ── report command ──

  describe('report <scanId>', () => {
    it('generates JSON report by default', async () => {
      mockGenerateJsonReport.mockReturnValue('{"scan":{},"findings":[]}')

      await program.parseAsync(['node', 'obt', 'report', 'scan-1'])

      expect(mockGenerateJsonReport).toHaveBeenCalledTimes(1)
      expect(mockConsoleLog).toHaveBeenCalledWith('{"scan":{},"findings":[]}')
    })

    it('generates CSV report when --format csv', async () => {
      mockGenerateCsvReport.mockReturnValue('id,title,severity\n')

      await program.parseAsync(['node', 'obt', 'report', 'scan-1', '--format', 'csv'])

      expect(mockGenerateCsvReport).toHaveBeenCalledTimes(1)
      expect(mockConsoleLog).toHaveBeenCalledWith('id,title,severity\n')
    })

    it('generates SARIF report when --format sarif', async () => {
      mockGenerateSarifReport.mockReturnValue('{"$schema":"...","version":"2.1.0"}')

      await program.parseAsync(['node', 'obt', 'report', 'scan-1', '-f', 'sarif'])

      expect(mockGenerateSarifReport).toHaveBeenCalledTimes(1)
    })

    it('generates Markdown report when --format md', async () => {
      mockRenderReport.mockReturnValue('# Report')

      await program.parseAsync(['node', 'obt', 'report', 'scan-1', '--format', 'md'])

      expect(mockRenderReport).toHaveBeenCalledTimes(1)
      expect(mockRenderReport).toHaveBeenCalledWith('scan-1', expect.any(Array))
    })

    it('prints error and sets exit code for unknown scan', async () => {
      // Override DB mock for this test: scan not found
      const notFoundDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([]),
      }
      mockGetDb.mockReturnValue(notFoundDb)

      await program.parseAsync(['node', 'obt', 'report', 'nonexistent'])

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })

    it('prints error for unknown format', async () => {
      await program.parseAsync(['node', 'obt', 'report', 'scan-1', '--format', 'xml'])

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown format'))
    })
  })

  // ── agents command ──

  describe('agents', () => {
    it('lists all agent definitions with PATH detection status', async () => {
      mockResolveOnPath
        .mockReturnValueOnce(true)   // claude
        .mockReturnValueOnce(false)  // codex
        .mockReturnValueOnce(true)   // gemini

      await program.parseAsync(['node', 'obt', 'agents'])

      expect(mockResolveOnPath).toHaveBeenCalledTimes(3)
      expect(mockResolveOnPath).toHaveBeenCalledWith('claude')
      expect(mockResolveOnPath).toHaveBeenCalledWith('codex')
      expect(mockResolveOnPath).toHaveBeenCalledWith('gemini')

      // Each agent printed with status
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('claude'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('detected'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })

    it('shows all agents as not found when none on PATH', async () => {
      mockResolveOnPath
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)

      await program.parseAsync(['node', 'obt', 'agents'])

      expect(mockResolveOnPath).toHaveBeenCalledTimes(3)
      // All three output lines should say "not found"
      const logCalls = mockConsoleLog.mock.calls as string[][]
      const allStrings = logCalls.map((c) => c[0]).join(' ')
      expect(allStrings).not.toContain('detected')
      expect(allStrings).toContain('not found')
    })
  })
})
