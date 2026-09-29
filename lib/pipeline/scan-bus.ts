import { EventEmitter } from 'events'
import type { ScanEvent } from './events'
import { isHighPriorityEvent } from './events'

const MAX_BUFFER = 256
const REPLAY_COUNT = 100

type Listener = (event: ScanEvent) => void

interface BusEntry {
  emitter: EventEmitter
  buffer: ScanEvent[]
}

export interface ScanBus {
  /**
   * Subscribe to events for a given scan.
   * Returns an unsubscribe function.
   */
  subscribe(scanId: string, listener: Listener): () => void

  /**
   * Publish an event to all listeners for a given scan.
   * Also appends to the bounded buffer (max 256 events).
   */
  publish(scanId: string, event: ScanEvent): void

  /**
   * Returns the last 100 events from the buffer for a given scan.
   * Returns [] if the scan is unknown.
   */
  replay(scanId: string): ScanEvent[]

  /**
   * Remove the emitter and buffer for a given scan.
   * After destroy, existing subscribers stop receiving events.
   */
  destroy(scanId: string): void
}

/**
 * Per-scan event bus backed by Node EventEmitter.
 *
 * Buffer policy:
 * - Max 256 events per scan in memory
 * - When at capacity, drop the oldest `progress` event first
 * - If no progress events remain, drop the oldest event (lossy — rare case)
 * - High-priority events (finding, error, done, stage) are never proactively dropped
 */
export function createScanBus(): ScanBus {
  const entries = new Map<string, BusEntry>()

  function getOrCreate(scanId: string): BusEntry {
    const existing = entries.get(scanId)
    if (existing) return existing
    const entry: BusEntry = { emitter: new EventEmitter(), buffer: [] }
    entry.emitter.setMaxListeners(0)
    entries.set(scanId, entry)
    return entry
  }

  function appendToBuffer(entry: BusEntry, event: ScanEvent): void {
    if (entry.buffer.length < MAX_BUFFER) {
      entry.buffer.push(event)
      return
    }

    // Buffer is full — drop the oldest progress event to make room
    const oldestProgressIdx = entry.buffer.findIndex((e) => e.type === 'progress')
    if (oldestProgressIdx !== -1) {
      entry.buffer.splice(oldestProgressIdx, 1)
    } else {
      // No progress events — drop oldest event (can happen when all events are high-priority)
      entry.buffer.shift()
    }
    entry.buffer.push(event)
  }

  return {
    subscribe(scanId: string, listener: Listener): () => void {
      const entry = getOrCreate(scanId)
      entry.emitter.on('event', listener)
      return () => {
        entry.emitter.off('event', listener)
      }
    },

    publish(scanId: string, event: ScanEvent): void {
      const entry = getOrCreate(scanId)
      appendToBuffer(entry, event)
      entry.emitter.emit('event', event)
    },

    replay(scanId: string): ScanEvent[] {
      const entry = entries.get(scanId)
      if (!entry) return []
      const buf = entry.buffer
      return buf.slice(Math.max(0, buf.length - REPLAY_COUNT))
    },

    destroy(scanId: string): void {
      const entry = entries.get(scanId)
      if (!entry) return
      entry.emitter.removeAllListeners()
      entries.delete(scanId)
    },
  }
}
