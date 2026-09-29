/**
 * lib/providers/transport/pending-turn-queue.ts
 *
 * Per-scan FIFO async queue for pending LLM turns.
 * Used by SessionManager to serialize the initial turn + injected turns.
 *
 * Design: module-level singleton map keeps one queue per active scanId.
 * Consumers call forScan(scanId) to get (or create) the queue instance,
 * and closeScan(scanId) to release it when the scan ends.
 */

/** A turn waiting to be sent to the LLM session. */
export interface PendingTurn {
  /** How this turn was created. */
  kind: 'initial' | 'inject' | 'redirect'
  /** The prompt content to send. */
  content: string
}

/** Internal queue instance for a single scan. */
export interface QueueInstance {
  /**
   * Adds a turn to the back of the queue.
   * If next() is already waiting, the promise resolves immediately.
   */
  enqueue(turn: PendingTurn): void

  /**
   * Returns a promise that resolves with the next turn in FIFO order.
   * If the queue is empty, the promise waits until enqueue() is called.
   */
  next(): Promise<PendingTurn>

  /** Returns true when there are no pending turns. */
  isEmpty(): boolean

  /** Removes all pending turns from the queue. Resolves no waiting promises. */
  drain(): void
}

/** Module-level singleton: scanId → QueueInstance */
const instances = new Map<string, QueueInstance>()

/**
 * Creates a `QueueInstance` backed by an internal array + promise resolver.
 */
function createQueueInstance(): QueueInstance {
  const items: PendingTurn[] = []
  // When next() is called on an empty queue, the resolve fn is stored here.
  let pending: ((turn: PendingTurn) => void) | null = null

  return {
    enqueue(turn: PendingTurn): void {
      if (pending !== null) {
        // next() is already waiting — deliver directly
        const resolve = pending
        pending = null
        resolve(turn)
      } else {
        items.push(turn)
      }
    },

    next(): Promise<PendingTurn> {
      if (items.length > 0) {
        return Promise.resolve(items.shift()!)
      }
      // Queue is empty — return a promise that resolves when enqueue is called
      return new Promise<PendingTurn>((resolve) => {
        pending = resolve
      })
    },

    isEmpty(): boolean {
      return items.length === 0 && pending === null
    },

    drain(): void {
      items.length = 0
      // Note: we do NOT resolve the pending promise — the awaiter will never get a value.
      // The caller is responsible for ensuring next() is not awaited after drain().
      pending = null
    },
  }
}

/**
 * Returns (or creates) the `QueueInstance` for the given scan.
 * Multiple calls with the same `scanId` return the same instance.
 *
 * @param scanId - The scan identifier.
 * @returns The per-scan queue instance.
 */
export function forScan(scanId: string): QueueInstance {
  let instance = instances.get(scanId)
  if (instance === undefined) {
    instance = createQueueInstance()
    instances.set(scanId, instance)
  }
  return instance
}

/**
 * Removes and discards the queue instance for a scan.
 * Call this when the scan ends to free memory.
 *
 * @param scanId - The scan identifier to release.
 */
export function closeScan(scanId: string): void {
  const instance = instances.get(scanId)
  if (instance !== undefined) {
    instance.drain()
    instances.delete(scanId)
  }
}
