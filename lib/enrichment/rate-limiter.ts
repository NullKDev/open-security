/**
 * rate-limiter.ts — Token-bucket rate limiter for external API calls
 *
 * Used to throttle EPSS requests to FIRST.org at 10 req/sec.
 */

export interface RateLimiter {
  /** Acquires a token. Resolves when the caller is allowed to proceed. */
  acquire(): Promise<void>
}

/**
 * Creates a simple token-bucket rate limiter.
 *
 * Allows `maxPerSecond` requests per second. Excess requests are queued
 * and released as tokens refill. The bucket refills linearly over 1-second
 * windows using a schedule-based queue with setTimeout.
 *
 * @param maxPerSecond - Maximum number of requests allowed per second
 * @returns RateLimiter instance with an `acquire()` method
 */
export function createRateLimiter(maxPerSecond: number): RateLimiter {
  /** Number of tokens currently available */
  let tokens = maxPerSecond
  /** Queue of resolve functions waiting for a token */
  const queue: Array<() => void> = []
  /** Whether a refill timer is currently scheduled */
  let refillScheduled = false

  function scheduleRefill(): void {
    if (refillScheduled) return
    refillScheduled = true

    setTimeout(() => {
      refillScheduled = false
      // Refill the bucket fully
      tokens = maxPerSecond

      // Drain as many queued waiters as possible
      while (tokens > 0 && queue.length > 0) {
        tokens--
        const resolve = queue.shift()!
        resolve()
      }

      // If queue still has waiters, schedule another refill
      if (queue.length > 0) {
        scheduleRefill()
      }
    }, 1000)
  }

  return {
    acquire(): Promise<void> {
      if (tokens > 0) {
        tokens--
        return Promise.resolve()
      }

      // No tokens available — queue the request and schedule a refill
      scheduleRefill()
      return new Promise<void>((resolve) => {
        queue.push(resolve)
      })
    },
  }
}
