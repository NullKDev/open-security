import { describe, it, expect, vi } from 'vitest'
import type { ProviderEvent, ErrorEvent } from '@/lib/providers/index'

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

// Build a fake SDK message stream from an array of messages
async function* fakeQueryFn(messages: Record<string, unknown>[]) {
  for (const msg of messages) yield msg
}

describe('claudeSdkScan', () => {
  it('yields error when SDK package is not installed', async () => {
    // Mock dynamic import to fail
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => {
      throw new Error('MODULE_NOT_FOUND')
    })
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    expect(events[0].type).toBe('error')
    expect((events[0] as ErrorEvent).message).toContain('bun add')
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('yields error when SDK has no query() function', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({ query: 'not-a-function' }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    expect(events[0].type).toBe('error')
    expect((events[0] as ErrorEvent).message).toContain('query()')
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits ThinkingEvent from thinking content block', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '## Analyzing auth code...' },
          ],
        },
      },
      { type: 'result', subtype: 'success' },
    ]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const thinking = events.filter((e) => e.type === 'thinking')
    expect(thinking).toHaveLength(1)
    if (thinking[0].type === 'thinking') {
      expect(thinking[0].format).toBe('markdown')
      expect(thinking[0].text).toContain('Analyzing auth code')
    }
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits ResponseEvent from text content block (routed through shared parser)', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Analyzing the codebase...' }],
        },
      },
      { type: 'result', subtype: 'success' },
    ]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const responses = events.filter((e) => e.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0].type === 'response') {
      expect(responses[0].text).toBe('Analyzing the codebase...')
    }
    // Should NOT be a progress event
    const progress = events.filter((e) => e.type === 'progress')
    expect(progress).toHaveLength(0)
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits FindingEvent when text block contains valid finding JSON line', async () => {
    const finding = JSON.stringify({
      title: 'SQL Injection',
      description: 'Unsanitized input',
      severity: 'high',
      location: 'src/db.ts:42',
    })
    const messages = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: finding }],
        },
      },
      { type: 'result', subtype: 'success' },
    ]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const findings = events.filter((e) => e.type === 'finding')
    expect(findings).toHaveLength(1)
    if (findings[0].type === 'finding') {
      expect(findings[0].title).toBe('SQL Injection')
    }
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits ProgressEvent for tool_use block', async () => {
    const messages = [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'read_file' }] },
      },
      { type: 'result', subtype: 'success' },
    ]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const progress = events.filter((e) => e.type === 'progress')
    expect(progress[0].message).toContain('[tool:read_file]')
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits DoneEvent on result subtype success', async () => {
    const messages = [{ type: 'result', subtype: 'success' }]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const done = events.filter((e) => e.type === 'done')
    expect(done).toHaveLength(1)
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits ErrorEvent on result subtype error', async () => {
    const messages = [{ type: 'result', subtype: 'error', result: 'permission denied' }]
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQueryFn(messages),
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('permission denied')
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })

  it('emits ErrorEvent when query() throws', async () => {
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => {
        throw new Error('SDK crash')
      },
    }))
    const { claudeSdkScan } = await import('@/lib/providers/sdk/claude')
    const events = await collect(
      claudeSdkScan(null, 'scan prompt', { targetPath: '/tmp/repo' }),
    )
    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('SDK crash')
    vi.doUnmock('@anthropic-ai/claude-agent-sdk')
  })
})
