/**
 * tests/unit/remediation/git-ops.test.ts
 *
 * TDD: T-D01 — git-ops module
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the git-ops module which runs git commands via child_process.spawn
 * in argv form (no shell interpolation).
 *
 * Strategy: Use vi.mock with factory to provide a mocked spawn. The mock is
 * set up per-test via the exported `__setSpawnMock` escape hatch which is
 * only available in test mode. For pure-function tests (buildBranchName),
 * no mocking is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Must be hoisted before imports
vi.mock('node:child_process', () => {
  const mockSpawn = vi.fn()
  return { spawn: mockSpawn, default: { spawn: mockSpawn } }
})

import { spawn } from 'node:child_process'
import {
  buildBranchName,
  runGitCommand,
  checkoutBranch,
  applyPatch,
} from '@/lib/remediation/git-ops'

const mockSpawn = vi.mocked(spawn)

/** Creates a fake spawn result for a given exit code + output */
function makeSpawnResult(code: number, stdout = '', stderr = '') {
  const result = {
    stdout: {
      on: vi.fn((ev: string, cb: (d: Buffer) => void) => {
        if (ev === 'data' && stdout) cb(Buffer.from(stdout))
      }),
    },
    stderr: {
      on: vi.fn((ev: string, cb: (d: Buffer) => void) => {
        if (ev === 'data' && stderr) cb(Buffer.from(stderr))
      }),
    },
    on: vi.fn((ev: string, cb: (code: number) => void) => {
      if (ev === 'close') cb(code)
    }),
  }
  return result as unknown as ReturnType<typeof spawn>
}

// ─── Pure function tests ────────────────────────────────────────────────────

describe('buildBranchName', () => {
  it('returns sec/fix/<first 8 chars of findingId>', () => {
    const name = buildBranchName('abcdef12-3456-7890-abcd-ef1234567890')
    expect(name).toBe('sec/fix/abcdef12')
  })

  it('works with different IDs (still takes first 8 chars)', () => {
    const name = buildBranchName('12345678abcdefgh')
    expect(name).toBe('sec/fix/12345678')
  })

  it('always produces the sec/fix/ prefix', () => {
    const name = buildBranchName('ffffffff-0000-1111-2222-333333333333')
    expect(name.startsWith('sec/fix/')).toBe(true)
  })
})

// ─── runGitCommand tests ─────────────────────────────────────────────────────

describe('runGitCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('resolves with exit code 0 and captured stdout on success', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(0, 'main\n'))

    const result = await runGitCommand('/tmp/repo', ['rev-parse', '--abbrev-ref', 'HEAD'], 5000)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('main')
  })

  it('resolves with non-zero exit code and stderr on failure', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(128, '', 'fatal: not a git repo'))

    const result = await runGitCommand('/tmp/repo', ['status'], 5000)

    expect(result.code).toBe(128)
    expect(result.stderr).toContain('fatal: not a git repo')
  })

  it('uses argv form — spawn called with array args and shell:false', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(0))

    await runGitCommand('/repo', ['checkout', '-b', 'sec/fix/abc123', 'HEAD'], 5000)

    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '-b', 'sec/fix/abc123', 'HEAD'],
      expect.objectContaining({ shell: false }),
    )
  })
})

// ─── checkoutBranch tests ────────────────────────────────────────────────────

describe('checkoutBranch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns ok:true when git checkout exits 0', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(0))

    const result = await checkoutBranch('/repo', 'sec/fix/abc12345', 'deadbeef')

    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns ok:false with stderr when git checkout fails', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(1, '', 'branch already exists'))

    const result = await checkoutBranch('/repo', 'sec/fix/abc12345', 'deadbeef')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('branch already exists')
  })
})

// ─── applyPatch tests ─────────────────────────────────────────────────────────

describe('applyPatch', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ops-test-'))
    vi.resetAllMocks()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns ok:true when git apply check and apply both exit 0', async () => {
    // Both --check and apply succeed
    mockSpawn
      .mockReturnValueOnce(makeSpawnResult(0))  // --check
      .mockReturnValueOnce(makeSpawnResult(0))  // apply

    const result = await applyPatch('/repo', 'diff --git a/file.ts b/file.ts\n...')

    expect(result.ok).toBe(true)
  })

  it('returns ok:false when git apply --check fails; apply is not called', async () => {
    // Only --check is called, it fails
    mockSpawn.mockReturnValueOnce(makeSpawnResult(1, '', 'patch does not apply'))

    const result = await applyPatch('/repo', 'bad patch content')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('patch does not apply')
    // spawn called exactly once (--check), never for apply
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })
})
