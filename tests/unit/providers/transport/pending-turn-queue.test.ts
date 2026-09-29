/**
 * tests/unit/providers/transport/pending-turn-queue.test.ts
 *
 * TDD: T-010/T-011 — PendingTurnQueue
 * Tests for per-scan FIFO async turn queue.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  forScan,
  closeScan,
  type PendingTurn,
} from '@/lib/providers/transport/pending-turn-queue'

afterEach(() => {
  closeScan('test-scan-1')
  closeScan('test-scan-2')
  closeScan('test-scan-drain')
  closeScan('test-scan-multi')
  closeScan('test-scan-block')
})

describe('PendingTurnQueue', () => {
  describe('enqueue / isEmpty', () => {
    it('isEmpty returns true for a new queue', () => {
      const q = forScan('test-scan-1')
      expect(q.isEmpty()).toBe(true)
    })

    it('isEmpty returns false after enqueue', () => {
      const q = forScan('test-scan-1')
      q.enqueue({ kind: 'initial', content: 'hello' })
      expect(q.isEmpty()).toBe(false)
    })

    it('isEmpty returns true after all items dequeued', async () => {
      const q = forScan('test-scan-1')
      q.enqueue({ kind: 'initial', content: 'hi' })
      await q.next()
      expect(q.isEmpty()).toBe(true)
    })
  })

  describe('FIFO ordering', () => {
    it('dequeues items in the order they were enqueued', async () => {
      const q = forScan('test-scan-2')
      const turn1: PendingTurn = { kind: 'initial', content: 'first' }
      const turn2: PendingTurn = { kind: 'inject', content: 'second' }
      const turn3: PendingTurn = { kind: 'redirect', content: 'third' }

      q.enqueue(turn1)
      q.enqueue(turn2)
      q.enqueue(turn3)

      expect(await q.next()).toEqual(turn1)
      expect(await q.next()).toEqual(turn2)
      expect(await q.next()).toEqual(turn3)
    })
  })

  describe('next() blocks until push', () => {
    it('next() resolves when an item is enqueued after the call', async () => {
      const q = forScan('test-scan-block')
      const turn: PendingTurn = { kind: 'inject', content: 'delayed' }

      // Start waiting for the next item
      const nextPromise = q.next()

      // Enqueue after a micro-task delay
      await Promise.resolve()
      q.enqueue(turn)

      const result = await nextPromise
      expect(result).toEqual(turn)
    })
  })

  describe('drain()', () => {
    it('drain clears all pending items', () => {
      const q = forScan('test-scan-drain')
      q.enqueue({ kind: 'initial', content: 'a' })
      q.enqueue({ kind: 'inject', content: 'b' })
      q.drain()
      expect(q.isEmpty()).toBe(true)
    })

    it('drain does not affect a queue that is already empty', () => {
      const q = forScan('test-scan-drain')
      expect(() => q.drain()).not.toThrow()
      expect(q.isEmpty()).toBe(true)
    })
  })

  describe('forScan() — same instance per scanId', () => {
    it('forScan returns the same instance for the same scanId', () => {
      const q1 = forScan('test-scan-multi')
      const q2 = forScan('test-scan-multi')
      expect(q1).toBe(q2)
    })

    it('forScan returns different instances for different scanIds', () => {
      const q1 = forScan('test-scan-1')
      const q2 = forScan('test-scan-2')
      expect(q1).not.toBe(q2)
    })
  })

  describe('closeScan()', () => {
    it('closeScan removes the queue — next forScan creates a fresh one', () => {
      const q1 = forScan('test-scan-1')
      q1.enqueue({ kind: 'initial', content: 'data' })
      closeScan('test-scan-1')

      const q2 = forScan('test-scan-1')
      expect(q2.isEmpty()).toBe(true)
      expect(q2).not.toBe(q1)
    })
  })
})
