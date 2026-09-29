import { describe, it, expect } from 'vitest'
import { wrapStreamText } from '@/lib/providers/api/stream'
import type { ProviderEvent } from '@/lib/providers'

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iter) {
    items.push(item)
  }
  return items
}

/** Create an async iterable that yields the given chunks */
async function* makeTextStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('wrapStreamText', () => {
  it('emits response events for plain text chunks (parsed per-line)', async () => {
    const streamTextResult = {
      textStream: makeTextStream(['Hello world\n']),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    // Plain text → ResponseEvent, not ProgressEvent
    const responses = events.filter((e) => e.type === 'response')
    expect(responses.length).toBeGreaterThanOrEqual(1)
    if (responses[0].type === 'response') {
      expect(responses[0].text).toBe('Hello world')
      expect(responses[0].format).toBe('plain')
    }

    const last = events[events.length - 1]
    expect(last.type).toBe('done')
  })

  it('emits finding event when a chunk contains a valid finding JSON line', async () => {
    const finding = JSON.stringify({
      title: 'SQL Injection',
      description: 'Unsanitized input',
      severity: 'high',
      location: 'db.ts:42',
    })
    const streamTextResult = {
      textStream: makeTextStream([finding + '\n']),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    const findings = events.filter((e) => e.type === 'finding')
    expect(findings).toHaveLength(1)
    if (findings[0].type === 'finding') {
      expect(findings[0].title).toBe('SQL Injection')
    }
  })

  it('emits done when stream is empty', async () => {
    const streamTextResult = {
      textStream: makeTextStream([]),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
  })

  it('buffers partial lines and emits when newline arrives', async () => {
    const streamTextResult = {
      textStream: makeTextStream(['part', 'ial line\n']),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    const responses = events.filter((e) => e.type === 'response')
    expect(responses).toHaveLength(1)
    if (responses[0].type === 'response') {
      expect(responses[0].text).toBe('partial line')
    }
  })

  it('emits error when textStream throws', async () => {
    const streamTextResult = {
      textStream: (async function* () {
        yield 'before error\n'
        throw new Error('Connection reset')
      })(),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    const errorEvents = events.filter((e) => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThanOrEqual(1)
    expect(errorEvents[0].message).toContain('Connection reset')

    // response before the error should still be emitted
    const progressEvents = events.filter((e) => e.type === 'response')
    expect(progressEvents.length).toBe(1)
    expect(progressEvents[0].text).toBe('before error')
  })

  it('handles multiple lines in a single chunk', async () => {
    const finding = JSON.stringify({
      title: 'XSS',
      description: 'Unescaped output',
      severity: 'medium',
      location: 'view.ts:10',
    })
    const streamTextResult = {
      textStream: makeTextStream(['Analyzing...\n' + finding + '\nAll done.\n']),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    const findings = events.filter((e) => e.type === 'finding')
    expect(findings).toHaveLength(1)

    const responses = events.filter((e) => e.type === 'response')
    expect(responses).toHaveLength(2)
    if (responses[0].type === 'response') {
      expect(responses[0].text).toBe('Analyzing...')
    }
    if (responses[1].type === 'response') {
      expect(responses[1].text).toBe('All done.')
    }
  })

  it('detects tool calls in text stream', async () => {
    const streamTextResult = {
      textStream: makeTextStream(['[tool] read\nSome response\n']),
    }

    const events = await collect(
      wrapStreamText(streamTextResult as any),
    )

    const progress = events.filter((e) => e.type === 'progress')
    expect(progress).toHaveLength(1)

    const responses = events.filter((e) => e.type === 'response')
    expect(responses).toHaveLength(1)
  })
})
