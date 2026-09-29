/**
 * tests/unit/enrichment/rate-limiter.test.ts
 *
 * TDD: T-C03 — EPSS rate limiter
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * The rate limiter is a token bucket: allows maxPerSecond tokens per second.
 * acquire() returns a promise that resolves when the token is available.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRateLimiter } from '@/lib/enrichment/rate-limiter'

afterEach(() => {
  vi.useRealTimers()
})

describe('createRateLimiter', () => {
  describe('immediate execution under limit', () => {
    it('resolves immediately when first token is requested', async () => {
      vi.useFakeTimers()
      const limiter = createRateLimiter(10)

      let resolved = false
      const promise = limiter.acquire().then(() => { resolved = true })

      // Flush microtasks
      await Promise.resolve()
      vi.runAllTimers()
      await promise

      expect(resolved).toBe(true)
    })

    it('resolves immediately for maxPerSecond requests within same window', async () => {
      vi.useFakeTimers()
      const limiter = createRateLimiter(3)

      const start = Date.now()
      const promises = [limiter.acquire(), limiter.acquire(), limiter.acquire()]
      vi.runAllTimers()
      await Promise.all(promises)
      const elapsed = Date.now() - start

      // All 3 should resolve quickly (within one second)
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('throttling when over limit', () => {
    it('delays the (maxPerSecond+1)th token beyond one second window', async () => {
      vi.useFakeTimers()
      const limiter = createRateLimiter(2) // 2 req/sec

      let fourthResolved = false
      // First 2 go immediately
      const p1 = limiter.acquire()
      const p2 = limiter.acquire()
      // Third must wait
      const p3 = limiter.acquire().then(() => { fourthResolved = true })

      // Before advancing time: first two resolve, third does not
      await Promise.resolve()
      await Promise.resolve()

      expect(fourthResolved).toBe(false)

      // Advance 1 second
      vi.advanceTimersByTime(1000)
      await p3

      expect(fourthResolved).toBe(true)

      await Promise.all([p1, p2])
    })
  })

  describe('different max rates', () => {
    it('allows configuring 10 req/sec (the EPSS limit)', async () => {
      vi.useFakeTimers()
      const limiter = createRateLimiter(10)

      // 10 acquires should all resolve without delay
      const promises = Array.from({ length: 10 }, () => limiter.acquire())
      vi.runAllTimers()
      await Promise.all(promises)

      // 11th should be pending
      let eleventh = false
      const p11 = limiter.acquire().then(() => { eleventh = true })
      await Promise.resolve()
      await Promise.resolve()

      expect(eleventh).toBe(false)

      vi.advanceTimersByTime(1000)
      await p11
      expect(eleventh).toBe(true)
    })
  })
})
