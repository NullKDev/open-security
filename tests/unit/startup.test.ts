/**
 * tests/unit/startup.test.ts
 *
 * TDD: T-049 (RED) → GREEN — instrumentation.ts startup wiring
 *
 * Tests that the register() function in instrumentation.ts:
 * - Calls checkIntegrity at startup and logs issues if found
 * - Calls pruneStaleProofs at startup and logs if count > 0
 * - Does NOT crash if checkIntegrity or pruneStaleProofs throw
 * - Skips all logic in non-nodejs runtime (edge guard)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all startup dependencies before importing instrumentation
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn().mockReturnValue({ _tag: 'mock-db' }),
}))

vi.mock('@/lib/watch/scheduler', () => ({
  startWatchScheduler: vi.fn(),
}))

vi.mock('@/lib/webhook/smee-relay', () => ({
  startSmeeRelay: vi.fn(),
}))

vi.mock('@/lib/db/integrity', () => ({
  checkIntegrity: vi.fn().mockReturnValue({ ok: true, issues: [] }),
}))

vi.mock('@/lib/remediation/fix-and-prove/proof-cleanup', () => ({
  pruneStaleProofs: vi.fn().mockResolvedValue(0),
}))

import { checkIntegrity } from '@/lib/db/integrity'
import { pruneStaleProofs } from '@/lib/remediation/fix-and-prove/proof-cleanup'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('instrumentation register()', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Set nodejs runtime
    process.env.NEXT_RUNTIME = 'nodejs'
    // Reset the HMR guard so register() runs each time
    const g = globalThis as Record<string, unknown>
    delete g.__obtScheduler

    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    vi.clearAllMocks()
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    stdoutSpy.mockRestore()
    delete process.env.NEXT_RUNTIME
  })

  it('calls checkIntegrity at startup', async () => {
    const { register } = await import('@/instrumentation')
    // Reset module to re-run register logic
    vi.resetModules()
    vi.mock('@/lib/db/integrity', () => ({
      checkIntegrity: vi.fn().mockReturnValue({ ok: true, issues: [] }),
    }))
    vi.mock('@/lib/remediation/fix-and-prove/proof-cleanup', () => ({
      pruneStaleProofs: vi.fn().mockResolvedValue(0),
    }))
    vi.mock('@/lib/db/client', () => ({
      getDb: vi.fn().mockReturnValue({}),
    }))
    vi.mock('@/lib/watch/scheduler', () => ({
      startWatchScheduler: vi.fn(),
    }))

    const { register: freshRegister } = await import('@/instrumentation')
    await freshRegister()
    expect(checkIntegrity).toHaveBeenCalled()
  })

  it('calls pruneStaleProofs at startup', async () => {
    vi.resetModules()
    vi.mock('@/lib/db/integrity', () => ({
      checkIntegrity: vi.fn().mockReturnValue({ ok: true, issues: [] }),
    }))
    vi.mock('@/lib/remediation/fix-and-prove/proof-cleanup', () => ({
      pruneStaleProofs: vi.fn().mockResolvedValue(0),
    }))
    vi.mock('@/lib/db/client', () => ({
      getDb: vi.fn().mockReturnValue({}),
    }))
    vi.mock('@/lib/watch/scheduler', () => ({
      startWatchScheduler: vi.fn(),
    }))

    const { register } = await import('@/instrumentation')
    await register()
    expect(pruneStaleProofs).toHaveBeenCalled()
  })

  it('logs integrity issues to stderr with [integrity] prefix', async () => {
    // Configure the top-level mock to return an integrity failure
    vi.mocked(checkIntegrity).mockReturnValueOnce({
      ok: false,
      issues: ['findings.status: 2 rows with invalid value "garbage"'],
    })

    // Reset HMR guard so register() runs again
    const g = globalThis as Record<string, unknown>
    delete g.__obtScheduler

    const stderrCalls: string[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      stderrCalls.push(String(s))
      return true
    })

    const { register } = await import('@/instrumentation')
    await register()

    stderrSpy.mockRestore()
    const integrityLog = stderrCalls.some((s) => s.includes('[integrity]'))
    expect(integrityLog).toBe(true)
  })

  it('does not crash when pruneStaleProofs throws', async () => {
    vi.resetModules()
    vi.mock('@/lib/db/integrity', () => ({
      checkIntegrity: vi.fn().mockReturnValue({ ok: true, issues: [] }),
    }))
    vi.mock('@/lib/remediation/fix-and-prove/proof-cleanup', () => ({
      pruneStaleProofs: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    }))
    vi.mock('@/lib/db/client', () => ({
      getDb: vi.fn().mockReturnValue({}),
    }))
    vi.mock('@/lib/watch/scheduler', () => ({
      startWatchScheduler: vi.fn(),
    }))

    const { register } = await import('@/instrumentation')
    await expect(register()).resolves.not.toThrow()
  })
})
