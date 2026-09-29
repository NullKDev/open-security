/**
 * tests/unit/webhook/smee-relay.test.ts
 *
 * TDD: T-C05 — smee relay start/stop lifecycle
 * RED → GREEN → REFACTOR
 *
 * NOTE: We don't actually connect to smee.io in unit tests.
 * We verify the module interface and that the stop function can be called
 * without throwing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock EventSource as a proper class constructor
const closeMock = vi.fn()
let lastInstance: MockEventSource | null = null

class MockEventSource {
  close = closeMock
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  onmessage: null | ((e: MessageEvent) => void) = null
  onerror: null | ((e: Event) => void) = null
  readyState = 0
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  constructor(public url: string) {
    lastInstance = this
  }
}

vi.stubGlobal('EventSource', MockEventSource)

describe('startSmeeRelay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeMock.mockClear()
    lastInstance = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports startSmeeRelay as a function', async () => {
    const { startSmeeRelay } = await import('@/lib/webhook/smee-relay')
    expect(typeof startSmeeRelay).toBe('function')
  })

  it('returns a stop function', async () => {
    const { startSmeeRelay } = await import('@/lib/webhook/smee-relay')
    const stop = startSmeeRelay('https://smee.io/test-channel', 'http://localhost:3000/api/webhooks/github')
    expect(typeof stop).toBe('function')
    // Clean up
    stop()
  })

  it('stop function closes the EventSource connection', async () => {
    const { startSmeeRelay } = await import('@/lib/webhook/smee-relay')
    const stop = startSmeeRelay('https://smee.io/test-channel', 'http://localhost:3000/api/webhooks/github')
    stop()
    expect(closeMock).toHaveBeenCalledOnce()
  })

  it('creates EventSource with the channel URL', async () => {
    const { startSmeeRelay } = await import('@/lib/webhook/smee-relay')
    const channelUrl = 'https://smee.io/my-channel-id'
    const stop = startSmeeRelay(channelUrl, 'http://localhost:3000/api/webhooks/github')
    expect(lastInstance?.url).toBe(channelUrl)
    stop()
  })
})
