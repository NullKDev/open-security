import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ollamaHttpScan, probeOllama } from '@/lib/providers/transport/http'
import type { ProviderEvent, ErrorEvent } from '@/lib/providers/index'

// Mock global fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

function makeOllamaStream(chunks: Array<{ content: string; done: boolean }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const line = JSON.stringify({
          model: 'llama3',
          message: { role: 'assistant', content: chunk.content },
          done: chunk.done,
        })
        controller.enqueue(encoder.encode(line + '\n'))
      }
      controller.close()
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('probeOllama', () => {
  it('returns true when /api/version responds OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    const result = await probeOllama()
    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/version',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('returns false when /api/version fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    const result = await probeOllama()
    expect(result).toBe(false)
  })

  it('returns false when fetch throws (daemon not running)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const result = await probeOllama()
    expect(result).toBe(false)
  })
})

describe('ollamaHttpScan', () => {
  it('yields error event when daemon is not running', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }) // probe fails
    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect((events[0] as ErrorEvent).message).toContain('ollama serve')
  })

  it('yields error event when fetch throws on probe', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    expect(events[0].type).toBe('error')
  })

  it('yields error event when HTTP chat request fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true }) // probe succeeds
      .mockRejectedValueOnce(new Error('network error')) // chat request fails
    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    expect(events[0].type).toBe('error')
    expect((events[0] as ErrorEvent).message).toContain('network error')
  })

  it('yields error event on non-OK HTTP status', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 404 })
    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    expect(events[0].type).toBe('error')
    expect((events[0] as ErrorEvent).message).toContain('404')
  })

  it('emits done event when stream finishes successfully', async () => {
    const stream = makeOllamaStream([
      { content: 'Analyzing...', done: false },
      { content: '', done: true },
    ])
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream })

    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(events[events.length - 1].type).toBe('done')
  })

  it('parses a valid finding from streamed text', async () => {
    const finding = JSON.stringify({
      title: 'SQL Injection',
      description: 'Unsanitized input',
      severity: 'high',
      location: 'db.ts:42',
      detector: 'llm',
    })
    const stream = makeOllamaStream([
      { content: finding + '\n', done: false },
      { content: '', done: true },
    ])
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream })

    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    const findings = events.filter((e) => e.type === 'finding')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ type: 'finding', title: 'SQL Injection', severity: 'high' })
  })

  it('emits response event for non-finding LLM prose', async () => {
    const stream = makeOllamaStream([
      { content: 'Reviewing source files...\n', done: false },
      { content: '', done: true },
    ])
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream })

    const events = await collect(ollamaHttpScan('llama3', 'scan prompt'))
    const responses = events.filter((e) => e.type === 'response')
    expect(responses.length).toBeGreaterThan(0)
  })
})
