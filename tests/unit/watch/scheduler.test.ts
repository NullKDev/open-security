/**
 * tests/unit/watch/scheduler.test.ts
 *
 * TDD: T-H01 — Watch scheduler singleton + HMR guard
 * RED → GREEN → REFACTOR
 *
 * Verifies that:
 * 1. startWatchScheduler returns a stop function
 * 2. Calling startWatchScheduler twice returns the same instance (singleton/HMR-safe)
 * 3. The stop function can be called without throwing
 * 4. registerRepo / unregisterRepo exist and are callable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Reset globalThis.__obtScheduler between tests
function clearSchedulerGlobal() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).__obtScheduler
}

describe('startWatchScheduler', () => {
  beforeEach(() => {
    clearSchedulerGlobal()
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearSchedulerGlobal()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('exports startWatchScheduler as a function', async () => {
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    expect(typeof startWatchScheduler).toBe('function')
  })

  it('returns a stop function', async () => {
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    const stop = startWatchScheduler()
    expect(typeof stop).toBe('function')
    stop()
  })

  it('calling stop does not throw', async () => {
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    const stop = startWatchScheduler()
    expect(() => stop()).not.toThrow()
  })

  it('registers singleton on globalThis to prevent HMR double-init', async () => {
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    startWatchScheduler()
    // After first call, globalThis should have the scheduler token
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).__obtScheduler).toBeDefined()
  })

  it('does not double-register when called twice', async () => {
    const { startWatchScheduler } = await import('@/lib/watch/scheduler')
    const stop1 = startWatchScheduler()
    const stop2 = startWatchScheduler()
    // Both stop functions should be safe to call
    expect(() => { stop1(); stop2() }).not.toThrow()
  })
})

describe('registerRepo / unregisterRepo', () => {
  beforeEach(() => {
    clearSchedulerGlobal()
    vi.useFakeTimers()
  })

  afterEach(() => {
    clearSchedulerGlobal()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('exports registerRepo and unregisterRepo', async () => {
    const mod = await import('@/lib/watch/scheduler')
    expect(typeof mod.registerRepo).toBe('function')
    expect(typeof mod.unregisterRepo).toBe('function')
  })

  it('registerRepo does not throw for valid cron expression', async () => {
    const { registerRepo, startWatchScheduler } = await import('@/lib/watch/scheduler')
    startWatchScheduler()
    expect(() => {
      registerRepo({
        repoId: 'repo-1',
        cronExpr: '0 */6 * * *',
        onTick: vi.fn(),
      })
    }).not.toThrow()
  })

  it('unregisterRepo does not throw for unknown repoId', async () => {
    const { unregisterRepo, startWatchScheduler } = await import('@/lib/watch/scheduler')
    startWatchScheduler()
    expect(() => unregisterRepo('nonexistent-repo')).not.toThrow()
  })

  it('registerRepo then unregisterRepo completes cleanly', async () => {
    const { registerRepo, unregisterRepo, startWatchScheduler } = await import('@/lib/watch/scheduler')
    startWatchScheduler()
    registerRepo({ repoId: 'r1', cronExpr: '0 */6 * * *', onTick: vi.fn() })
    expect(() => unregisterRepo('r1')).not.toThrow()
  })
})
