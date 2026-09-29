import type { ProviderEvent } from '../index'
import { textLineToEvent } from '../shared/line-parser'

/**
 * Minimal interface representing a `streamText` result from Vercel AI SDK v6.
 *
 * We only depend on the `textStream` property — an AsyncIterable of string chunks.
 * This allows easy mocking in tests without importing the full SDK.
 */
export interface StreamTextLike {
  textStream: AsyncIterable<string>
}

/**
 * Wrap a Vercel AI SDK `streamText` result into a ProviderEvent async iterator.
 *
 * Buffers text chunks, splits on newlines, and classifies each line through
 * the shared `textLineToEvent` parser. This replaces the old per-chunk
 * ProgressEvent emission with structured events:
 *   - Valid finding JSON lines → FindingEvent
 *   - `[tool]` lines → ProgressEvent
 *   - Everything else → ResponseEvent
 *
 * If the stream throws, an `error` event is emitted before the final `done`.
 * The `done` event is always emitted (in a `finally` block).
 *
 * @param result A streamText-like object with a `textStream` async iterable
 */
export async function* wrapStreamText(
  result: StreamTextLike,
): AsyncIterable<ProviderEvent> {
  let buffer = ''

  try {
    for await (const chunk of result.textStream) {
      buffer += chunk

      // Split on newlines, keeping incomplete last line in buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) yield textLineToEvent(trimmed)
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      raw: err,
    }
  } finally {
    // Flush remaining buffer as final line
    const final = buffer.trim()
    if (final) yield textLineToEvent(final)
    yield { type: 'done' }
  }
}
