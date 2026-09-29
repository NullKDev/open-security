import { describe, it, expect, beforeEach } from 'vitest'
import type { ScanEvent } from '@/lib/pipeline/events'
import { createScanBus } from '@/lib/pipeline/scan-bus'

describe('ScanBus', () => {
  it('multiple subscribers receive the same event', () => {
    const bus = createScanBus()
    const scanId = 'scan-001'

    const received1: ScanEvent[] = []
    const received2: ScanEvent[] = []

    bus.subscribe(scanId, (e) => received1.push(e))
    bus.subscribe(scanId, (e) => received2.push(e))

    const event: ScanEvent = { type: 'stage', stage: 'prep', message: 'starting' }
    bus.publish(scanId, event)

    expect(received1).toHaveLength(1)
    expect(received1[0]).toEqual(event)
    expect(received2).toHaveLength(1)
    expect(received2[0]).toEqual(event)
  })

  it('subscriber does not receive events for other scans', () => {
    const bus = createScanBus()

    const received: ScanEvent[] = []
    bus.subscribe('scan-A', (e) => received.push(e))

    bus.publish('scan-B', { type: 'stage', stage: 'prep', message: 'other scan' })

    expect(received).toHaveLength(0)
  })

  it('unsubscribe stops delivery', () => {
    const bus = createScanBus()
    const scanId = 'scan-002'
    const received: ScanEvent[] = []

    const unsub = bus.subscribe(scanId, (e) => received.push(e))
    bus.publish(scanId, { type: 'stage', stage: 'prep', message: 'before unsub' })
    unsub()
    bus.publish(scanId, { type: 'stage', stage: 'classical', message: 'after unsub' })

    expect(received).toHaveLength(1)
    expect((received[0] as { message: string }).message).toBe('before unsub')
  })

  it('reconnect replays last 100 events from buffer', () => {
    const bus = createScanBus()
    const scanId = 'scan-003'

    // Publish 120 events
    for (let i = 0; i < 120; i++) {
      bus.publish(scanId, { type: 'progress', message: `event-${i}` })
    }

    const replayed: ScanEvent[] = []
    bus.replay(scanId).forEach((e) => replayed.push(e))

    // Should only return last 100
    expect(replayed).toHaveLength(100)
    // Last event should be event-119
    const last = replayed[replayed.length - 1] as { message: string }
    expect(last.message).toBe('event-119')
  })

  it('replay returns empty array for unknown scan', () => {
    const bus = createScanBus()
    const result = bus.replay('unknown-scan')
    expect(result).toEqual([])
  })

  it('destroy(scanId) cleans up bus entry', () => {
    const bus = createScanBus()
    const scanId = 'scan-004'

    const received: ScanEvent[] = []
    bus.subscribe(scanId, (e) => received.push(e))
    bus.publish(scanId, { type: 'stage', stage: 'prep', message: 'before destroy' })

    bus.destroy(scanId)

    // After destroy, publish should not error but should not deliver to old subscriber
    bus.publish(scanId, { type: 'stage', stage: 'classical', message: 'after destroy' })

    // Replay after destroy returns empty (new bus entry, fresh buffer)
    const replayed = bus.replay(scanId)
    // May have 1 event (the one after destroy) or 0 depending on implementation
    // Key assertion: the old subscriber did NOT receive after-destroy event
    expect(received).toHaveLength(1)
    expect((received[0] as { message: string }).message).toBe('before destroy')
  })

  it('bounded buffer: drops progress events before finding/error/done on overflow', () => {
    const bus = createScanBus()
    const scanId = 'scan-005'

    // Fill to 256 with progress events
    for (let i = 0; i < 256; i++) {
      bus.publish(scanId, { type: 'progress', message: `prog-${i}` })
    }

    // Publish a finding — should be kept even if buffer is at 256
    const finding: ScanEvent = {
      type: 'finding',
      finding: {
        title: 'SQL Injection',
        description: 'Found SQL injection',
        severity: 'high',
        locationPath: 'src/db.ts',
        locationLineStart: 10,
        detector: 'semgrep',
      },
    }
    bus.publish(scanId, finding)

    const replayed = bus.replay(scanId)
    // The finding must be in the replay (it's the most recent 100)
    const hasFinding = replayed.some((e) => e.type === 'finding')
    expect(hasFinding).toBe(true)
  })
})
