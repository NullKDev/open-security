import { describe, it, expect, vi } from 'vitest'
import type { ProviderEvent, ScanOpts } from '@/lib/providers/index'
import type { AgentDef } from '@/lib/providers/cli/agents'

// ---------------------------------------------------------------------------
// Hoisted mocks — class defined inside vi.hoisted to survive vi.mock hoisting.
// ---------------------------------------------------------------------------
const { mockSessionManagerRun, MockSessionManager } = vi.hoisted(() => {
  const mockSessionManagerRun = vi.fn<(...args: unknown[]) => AsyncIterable<ProviderEvent>>()

  /** Proper class-based mock so `new SessionManager()` works in the adapter. */
  class MockSessionManager {
    run = mockSessionManagerRun
  }

  return { mockSessionManagerRun, MockSessionManager }
})

vi.mock('@/lib/providers/transport/session-manager', () => ({
  SessionManager: MockSessionManager,
}))

vi.mock('@/lib/providers/transport/traffic-logger', () => ({
  logTraffic: vi.fn(),
}))

import { acpScan } from '@/lib/providers/transport/acp'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

async function* asyncGen<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

const geminiDef: AgentDef = {
  id: 'gemini',
  name: 'Gemini',
  bin: 'gemini',
  probeArgs: ['--version'],
  streamFormat: 'json-event-stream',
  transport: 'acp',
  acpArgs: ['--acp'],
  fallbackModels: [],
  buildArgs: () => [],
}

const opts: ScanOpts = { targetPath: '/tmp/repo' }

// ---------------------------------------------------------------------------
// acpScan — thin adapter delegation
// ---------------------------------------------------------------------------

describe('acpScan (thin adapter)', () => {
  it('delegates to SessionManager.run() with correct arguments', async () => {
    mockSessionManagerRun.mockReturnValueOnce(asyncGen([]))

    await collect(acpScan(geminiDef, 'Find SQL injection', opts))

    expect(mockSessionManagerRun).toHaveBeenCalledTimes(1)
    expect(mockSessionManagerRun).toHaveBeenCalledWith(
      geminiDef,
      'Find SQL injection',
      opts,
    )
  })

  it('forwards all events from SessionManager unchanged', async () => {
    const events: ProviderEvent[] = [
      { type: 'progress', message: 'Starting...' },
      { type: 'progress', message: 'Analyzing...' },
      { type: 'done' },
    ]
    mockSessionManagerRun.mockReturnValueOnce(asyncGen(events))

    const result = await collect(acpScan(geminiDef, 'prompt', opts))

    expect(result).toEqual(events)
    expect(result).toHaveLength(3)
  })

  it('forwards error events from SessionManager', async () => {
    const events: ProviderEvent[] = [
      { type: 'error', message: 'Agent process exited with code 1: command not found' },
    ]
    mockSessionManagerRun.mockReturnValueOnce(asyncGen(events))

    const result = await collect(acpScan(geminiDef, 'prompt', opts))

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('error')
  })

  it('yields done as final event on successful scan', async () => {
    const events: ProviderEvent[] = [
      { type: 'progress', message: 'Working...' },
      { type: 'done' },
    ]
    mockSessionManagerRun.mockReturnValueOnce(asyncGen(events))

    const result = await collect(acpScan(geminiDef, 'prompt', opts))

    expect(result).toHaveLength(2)
    expect(result[result.length - 1].type).toBe('done')
  })

  it('handles SessionManager yielding only done (empty scan)', async () => {
    const events: ProviderEvent[] = [{ type: 'done' }]
    mockSessionManagerRun.mockReturnValueOnce(asyncGen(events))

    const result = await collect(acpScan(geminiDef, 'prompt', opts))

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('done')
  })

  it('passes through ScanOpts including modelId', async () => {
    const customOpts: ScanOpts = { targetPath: '/tmp/project', modelId: 'gpt-5' }
    mockSessionManagerRun.mockReturnValueOnce(asyncGen([]))

    await collect(acpScan(geminiDef, 'prompt', customOpts))

    expect(mockSessionManagerRun).toHaveBeenCalledWith(
      geminiDef,
      'prompt',
      customOpts,
    )
  })

  it('executes without crashing for minimal AgentDef', async () => {
    const minimalDef: AgentDef = {
      id: 'minimal',
      bin: 'minimal-agent',
      probeArgs: ['--version'],
      streamFormat: 'plain',
      transport: 'acp',
      fallbackModels: [],
      buildArgs: () => [],
    }
    mockSessionManagerRun.mockReturnValueOnce(asyncGen([{ type: 'done' }]))

    const result = await collect(acpScan(minimalDef, 'prompt', opts))

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('done')
  })
})
