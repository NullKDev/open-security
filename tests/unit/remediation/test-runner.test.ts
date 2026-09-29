/**
 * tests/unit/remediation/test-runner.test.ts
 *
 * TDD: T-D03 — test-runner module
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the test-runner which spawns the user-specified test command.
 * The test command is shell-evaluated (by user choice, per design §5),
 * but with a 600-second timeout and output capture.
 *
 * Testable units:
 * - runTestCommand: spawns test cmd, returns {passed, output, exitCode}
 * - truncateOutput: keeps only last 2000 chars of combined output
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => {
  const mockSpawn = vi.fn()
  return { spawn: mockSpawn, default: { spawn: mockSpawn } }
})

import { spawn } from 'node:child_process'
import { runTestCommand, truncateOutput } from '@/lib/remediation/test-runner'

const mockSpawn = vi.mocked(spawn)

/** Creates a fake spawn result for test commands */
function makeSpawnResult(code: number, stdout = '', stderr = '') {
  return {
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
  } as unknown as ReturnType<typeof spawn>
}

// ─── truncateOutput tests ────────────────────────────────────────────────────

describe('truncateOutput', () => {
  it('returns the string unchanged if <= 2000 chars', () => {
    const short = 'a'.repeat(100)
    expect(truncateOutput(short)).toBe(short)
  })

  it('truncates to last 2000 chars when longer', () => {
    const long = 'a'.repeat(1000) + 'b'.repeat(1500)
    const result = truncateOutput(long)
    expect(result).toHaveLength(2000)
    // Should be the last 2000 chars: 500 'a's + 1500 'b's
    expect(result).toBe('a'.repeat(500) + 'b'.repeat(1500))
  })

  it('handles strings of exactly 2000 chars without truncation', () => {
    const exact = 'x'.repeat(2000)
    expect(truncateOutput(exact)).toBe(exact)
    expect(truncateOutput(exact)).toHaveLength(2000)
  })
})

// ─── runTestCommand tests ─────────────────────────────────────────────────────

describe('runTestCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns passed:true with output when test command exits 0', async () => {
    mockSpawn.mockReturnValue(
      makeSpawnResult(0, 'All tests passed\n', ''),
    )

    const result = await runTestCommand('/repo', 'npm test')

    expect(result.passed).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('All tests passed')
  })

  it('returns passed:false when test command exits non-zero', async () => {
    mockSpawn.mockReturnValue(
      makeSpawnResult(1, '', '3 tests failed\n'),
    )

    const result = await runTestCommand('/repo', 'npm test')

    expect(result.passed).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('3 tests failed')
  })

  it('uses shell:true (test_command is user-provided and intentionally shell-evaluated)', async () => {
    mockSpawn.mockReturnValue(makeSpawnResult(0))

    await runTestCommand('/repo', 'npm test')

    expect(spawn).toHaveBeenCalledWith(
      'npm test',
      [],
      expect.objectContaining({ shell: true }),
    )
  })

  it('captures combined stdout + stderr in output', async () => {
    mockSpawn.mockReturnValue(
      makeSpawnResult(1, 'stdout-content', 'stderr-content'),
    )

    const result = await runTestCommand('/repo', 'npm test')

    expect(result.output).toContain('stdout-content')
    expect(result.output).toContain('stderr-content')
  })

  it('truncates output to 2000 chars when very large', async () => {
    const bigOutput = 'x'.repeat(5000)
    mockSpawn.mockReturnValue(makeSpawnResult(0, bigOutput))

    const result = await runTestCommand('/repo', 'npm test')

    expect(result.output.length).toBeLessThanOrEqual(2000)
  })
})
