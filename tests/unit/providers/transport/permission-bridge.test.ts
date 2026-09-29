import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PermissionBridge, getPermissionBridge } from '@/lib/providers/transport/permission-bridge'
import type { RequestPermissionRequest, PermissionOption } from '@agentclientprotocol/sdk'

// ---------------------------------------------------------------------------
// Mock PendingTurnQueue for redirect instruction tests (hoisted for vi.mock)
// ---------------------------------------------------------------------------
const { mockQueueEnqueue, mockForScan } = vi.hoisted(() => {
  const mockQueueEnqueue = vi.fn()
  const mockForScan = vi.fn().mockReturnValue({ enqueue: mockQueueEnqueue })
  return { mockQueueEnqueue, mockForScan }
})

vi.mock('@/lib/providers/transport/pending-turn-queue', () => ({
  forScan: mockForScan,
  closeScan: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock crypto.randomUUID for predictable requestIds
// ---------------------------------------------------------------------------
let uuidCounter = 0
const mockRandomUUID = vi.fn(() => {
  uuidCounter++
  return `req-${uuidCounter}`
})

vi.stubGlobal('crypto', {
  randomUUID: mockRandomUUID,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(): PermissionOption[] {
  return [
    { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
    { optionId: 'allow-always', kind: 'allow_always', name: 'Allow always' },
    { optionId: 'deny-once', kind: 'reject_once', name: 'Deny' },
  ]
}

function makeRequest(
  overrides: Partial<RequestPermissionRequest> = {},
): RequestPermissionRequest {
  return {
    sessionId: 'sess-test',
    toolCall: {
      toolCallId: 'tc-1',
      title: 'Run command',
      status: 'in_progress',
    },
    options: makeOptions(),
    ...overrides,
  } as RequestPermissionRequest
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionBridge', () => {
  beforeEach(() => {
    uuidCounter = 0
    mockRandomUUID.mockClear()
  })

  // -----------------------------------------------------------------------
  // Auto mode
  // -----------------------------------------------------------------------
  describe('auto mode', () => {
    it('resolves synchronously with the first allow option', async () => {
      const bridge = new PermissionBridge('auto')
      const params = makeRequest()

      const result = await bridge.requestPermission('scan-1', params)

      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'allow-once',
      })
    })

    it('falls back to the first option when no allow option exists', async () => {
      const bridge = new PermissionBridge('auto')
      const params = makeRequest({
        options: [
          { optionId: 'deny-once', kind: 'reject_once', name: 'Deny' },
          { optionId: 'deny-always', kind: 'reject_always', name: 'Deny always' },
        ],
      })

      const result = await bridge.requestPermission('scan-1', params)

      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'deny-once',
      })
    })

    it('does not create pending entries (resolveRequest returns false)', async () => {
      const bridge = new PermissionBridge('auto')
      const params = makeRequest()

      await bridge.requestPermission('scan-1', params)

      // No pending entry was created in auto mode
      const resolved = bridge.resolveRequest('scan-1', 'req-1', true)
      expect(resolved).toBe(false)
    })

    it('prefers allow_always over allow_once', async () => {
      const bridge = new PermissionBridge('auto')
      const params = makeRequest({
        options: [
          { optionId: 'deny-once', kind: 'reject_once', name: 'Deny' },
          { optionId: 'allow-always', kind: 'allow_always', name: 'Allow always' },
          { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
        ],
      })

      const result = await bridge.requestPermission('scan-1', params)

      // First allow option found (allow_always before allow_once)
      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'allow-always',
      })
    })
  })

  // -----------------------------------------------------------------------
  // Interactive mode — resolveRequest happy path
  // -----------------------------------------------------------------------
  describe('interactive mode — resolveRequest', () => {
    let bridge: PermissionBridge

    beforeEach(() => {
      bridge = new PermissionBridge('interactive')
    })

    it('resolveRequest with approved:true resolves the pending promise', async () => {
      const params = makeRequest()

      const promise = bridge.requestPermission('scan-1', params)
      // requestId is 'req-1' (mock)

      const resolved = bridge.resolveRequest('scan-1', 'req-1', true)
      expect(resolved).toBe(true)

      const result = await promise
      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'allow-once', // first allow option
      })
    })

    it('resolveRequest with approved:false returns cancelled outcome', async () => {
      const params = makeRequest()

      const promise = bridge.requestPermission('scan-1', params)
      // requestId is 'req-1'

      const resolved = bridge.resolveRequest('scan-1', 'req-1', false)
      expect(resolved).toBe(true)

      const result = await promise
      expect(result.outcome).toEqual({ outcome: 'cancelled' })
    })

    it('resolveRequest returns false for unknown requestId', () => {
      const result = bridge.resolveRequest('scan-1', 'nonexistent', true)
      expect(result).toBe(false)
    })

    it('resolveRequest returns false for wrong scanId', async () => {
      // Create a request for scan-1
      bridge.requestPermission('scan-1', makeRequest())
      // requestId is 'req-1' in scan-1

      // Try to resolve it from scan-2
      const result = bridge.resolveRequest('scan-2', 'req-1', true)
      expect(result).toBe(false)
    })

    it('resolveRequest picks first allow option when approved', async () => {
      const params = makeRequest({
        options: [
          { optionId: 'deny-once', kind: 'reject_once', name: 'Deny' },
          { optionId: 'allow-always', kind: 'allow_always', name: 'Allow always' },
        ],
      })

      const promise = bridge.requestPermission('scan-1', params)
      // requestId is 'req-1'

      bridge.resolveRequest('scan-1', 'req-1', true)

      const result = await promise
      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'allow-always',
      })
    })
  })

  // -----------------------------------------------------------------------
  // Interactive mode — timeout
  // -----------------------------------------------------------------------
  describe('interactive mode — timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('rejects the pending promise after 60 seconds', async () => {
      const bridge = new PermissionBridge('interactive')
      const params = makeRequest()

      const promise = bridge.requestPermission('scan-1', params)

      // Advance time past the 60s timeout
      vi.advanceTimersByTime(60_001)

      await expect(promise).rejects.toThrow('Permission timeout')
    })

    it('cleans up the pending entry after timeout', async () => {
      const bridge = new PermissionBridge('interactive')
      const params = makeRequest()

      const promise = bridge.requestPermission('scan-1', params)
      // requestId is 'req-1'

      // Advance past timeout
      vi.advanceTimersByTime(60_001)

      await expect(promise).rejects.toThrow('Permission timeout')

      // After timeout, resolveRequest should return false
      const result = bridge.resolveRequest('scan-1', 'req-1', true)
      expect(result).toBe(false)
    })

    it('does NOT fire timeout before 60s', async () => {
      const bridge = new PermissionBridge('interactive')

      const promise = bridge.requestPermission('scan-1', makeRequest())

      // Advance 59 seconds — should NOT have timed out yet
      vi.advanceTimersByTime(59_000)

      // Resolve before timeout
      bridge.resolveRequest('scan-1', 'req-1', true)

      const result = await promise
      expect(result.outcome).toMatchObject({
        outcome: 'selected',
        optionId: 'allow-once',
      })
    })

    it('timer is cleared when resolveRequest is called before timeout', async () => {
      const bridge = new PermissionBridge('interactive')

      const promise = bridge.requestPermission('scan-1', makeRequest())
      // requestId is 'req-1'

      // Resolve before timeout
      bridge.resolveRequest('scan-1', 'req-1', true)

      // Advance time — should NOT trigger timeout since timer was cleared
      vi.advanceTimersByTime(120_000)

      // Promise should already be resolved (not rejected)
      const result = await promise
      expect(result.outcome).toMatchObject({ outcome: 'selected' })
    })
  })

  // -----------------------------------------------------------------------
  // rejectAllForScan
  // -----------------------------------------------------------------------
  describe('rejectAllForScan', () => {
    it('rejects all pending promises for a scan', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1
      const p2 = bridge.requestPermission('scan-1', makeRequest())
      // req-2

      bridge.rejectAllForScan('scan-1')

      await expect(p1).rejects.toThrow('Scan cancelled')
      await expect(p2).rejects.toThrow('Scan cancelled')
    })

    it('does not affect pending requests from other scans', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1
      const p2 = bridge.requestPermission('scan-2', makeRequest())
      // req-2

      bridge.rejectAllForScan('scan-1')

      await expect(p1).rejects.toThrow('Scan cancelled')

      // p2 should still be pending (not rejected by scan-1 cleanup)
      // Resolve it to verify it's still alive
      const resolved = bridge.resolveRequest('scan-2', 'req-2', true)
      expect(resolved).toBe(true)

      const result = await p2
      expect(result.outcome).toMatchObject({ outcome: 'selected' })
    })

    it('clears the scan entry from the registry', async () => {
      const bridge = new PermissionBridge('interactive')

      const p = bridge.requestPermission('scan-1', makeRequest())
      // req-1

      bridge.rejectAllForScan('scan-1')

      // Promise should be rejected
      await expect(p).rejects.toThrow('Scan cancelled')

      // After rejection, resolveRequest should return false
      const result = bridge.resolveRequest('scan-1', 'req-1', true)
      expect(result).toBe(false)
    })

    it('is idempotent (calling twice does not throw)', () => {
      const bridge = new PermissionBridge('interactive')

      bridge.rejectAllForScan('scan-1')
      bridge.rejectAllForScan('scan-1') // should not throw
    })
  })

  // -----------------------------------------------------------------------
  // rejectRequest
  // -----------------------------------------------------------------------
  describe('rejectRequest', () => {
    it('rejects a specific pending promise with the given error', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1

      bridge.rejectRequest('scan-1', 'req-1', new Error('Custom error'))

      await expect(p1).rejects.toThrow('Custom error')
    })

    it('does not affect other requests in the same scan', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1
      const p2 = bridge.requestPermission('scan-1', makeRequest())
      // req-2

      bridge.rejectRequest('scan-1', 'req-1', new Error('Only req-1'))

      await expect(p1).rejects.toThrow('Only req-1')

      // p2 should still be pending
      bridge.resolveRequest('scan-1', 'req-2', true)
      const result = await p2
      expect(result.outcome).toMatchObject({ outcome: 'selected' })
    })

    it('is a no-op for unknown requestId', () => {
      const bridge = new PermissionBridge('interactive')
      // Does not throw
      bridge.rejectRequest('scan-1', 'nonexistent', new Error('No-op'))
    })

    it('is a no-op for wrong scanId', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1

      // Try to reject on wrong scan — should be no-op
      bridge.rejectRequest('scan-2', 'req-1', new Error('Wrong scan'))

      // p1 should still be pending
      bridge.resolveRequest('scan-1', 'req-1', true)
      const result = await p1
      expect(result.outcome).toMatchObject({ outcome: 'selected' })
    })
  })

  // -----------------------------------------------------------------------
  // Cross-scan isolation
  // -----------------------------------------------------------------------
  describe('cross-scan isolation', () => {
    it('resolveRequest for wrong scanId returns false', async () => {
      const bridge = new PermissionBridge('interactive')

      const p = bridge.requestPermission('scan-1', makeRequest())
      // req-1

      const result = bridge.resolveRequest('scan-2', 'req-1', true)
      expect(result).toBe(false)

      // Cleanup — resolve the pending promise to avoid unhandled rejection
      bridge.resolveRequest('scan-1', 'req-1', true)
      await p
    })

    it('rejectAllForScan on empty scan does not throw', () => {
      const bridge = new PermissionBridge('interactive')
      bridge.rejectAllForScan('scan-nonexistent') // should not throw
    })
  })

  // -----------------------------------------------------------------------
  // Multiple simultaneous scans
  // -----------------------------------------------------------------------
  describe('multiple simultaneous scans', () => {
    it('handles requests from different scans independently', async () => {
      const bridge = new PermissionBridge('interactive')

      const p1 = bridge.requestPermission('scan-1', makeRequest())
      // req-1
      const p2 = bridge.requestPermission('scan-2', makeRequest())
      // req-2

      // Resolve scan-1 first
      bridge.resolveRequest('scan-1', 'req-1', true)
      const r1 = await p1
      expect(r1.outcome).toMatchObject({ outcome: 'selected' })

      // scan-2 should still be pending
      bridge.resolveRequest('scan-2', 'req-2', false)
      const r2 = await p2
      expect(r2.outcome).toEqual({ outcome: 'cancelled' })
    })
  })
})

// ---------------------------------------------------------------------------
// getPermissionBridge singleton
// ---------------------------------------------------------------------------
describe('getPermissionBridge (singleton)', () => {
  it('returns the same instance on multiple calls', () => {
    const bridge1 = getPermissionBridge('auto')
    const bridge2 = getPermissionBridge('interactive')
    expect(bridge1).toBe(bridge2)
  })

  it('returns a working PermissionBridge in auto mode', async () => {
    const bridge = getPermissionBridge('auto')
    const result = await bridge.requestPermission('scan-1', makeRequest())
    expect(result.outcome).toMatchObject({
      outcome: 'selected',
    })
  })
})

// ---------------------------------------------------------------------------
// v0.3: resolveRequest with redirectInstruction
// ---------------------------------------------------------------------------
describe('resolveRequest — redirectInstruction (v0.3)', () => {
  beforeEach(() => {
    uuidCounter = 0
    mockRandomUUID.mockClear()
    mockQueueEnqueue.mockClear()
    mockForScan.mockClear()
  })

  it('enqueues a redirect turn when approved:false and redirectInstruction is provided', async () => {
    const bridge = new PermissionBridge('interactive')
    const params = makeRequest()

    const promise = bridge.requestPermission('scan-redirect', params)
    // requestId is 'req-1'

    bridge.resolveRequest('scan-redirect', 'req-1', false, 'do X instead of Y')

    // Await to avoid unhandled rejection
    await promise.catch(() => {})

    expect(mockForScan).toHaveBeenCalledWith('scan-redirect')
    expect(mockQueueEnqueue).toHaveBeenCalledWith({
      kind: 'redirect',
      content: 'do X instead of Y',
    })
  })

  it('does NOT enqueue when approved:false but no redirectInstruction', async () => {
    const bridge = new PermissionBridge('interactive')
    const params = makeRequest()

    const promise = bridge.requestPermission('scan-no-redirect', params)
    // requestId is 'req-1'

    bridge.resolveRequest('scan-no-redirect', 'req-1', false)

    await promise.catch(() => {})

    expect(mockQueueEnqueue).not.toHaveBeenCalled()
  })

  it('does NOT enqueue when approved:true even with redirectInstruction', async () => {
    const bridge = new PermissionBridge('interactive')
    const params = makeRequest()

    const promise = bridge.requestPermission('scan-approved', params)
    // requestId is 'req-1'

    bridge.resolveRequest('scan-approved', 'req-1', true, 'this should be ignored')

    await promise

    // Enqueue should NOT be called — redirect only fires on denial
    expect(mockQueueEnqueue).not.toHaveBeenCalled()
  })
})
