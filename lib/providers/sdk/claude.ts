import type { ProviderEvent, ScanOpts } from '../index'
import { textLineToEvent } from '../shared/line-parser'

/**
 * Execute a Claude security scan via @anthropic-ai/claude-agent-sdk.
 *
 * Requires @anthropic-ai/claude-agent-sdk to be installed:
 *   bun add @anthropic-ai/claude-agent-sdk
 *
 * Uses includePartialMessages to stream events in real-time (thinking, tool calls, text).
 * Text accumulates per block; findings are extracted when each block completes.
 */
export async function* claudeSdkScan(
  modelId: string | null,
  prompt: string,
  opts: ScanOpts,
): AsyncIterable<ProviderEvent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdk: any
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk')
  } catch {
    yield {
      type: 'error',
      message: 'Claude SDK not installed. Run: bun add @anthropic-ai/claude-agent-sdk',
    }
    return
  }

  const queryFn = sdk.query as ((queryOpts: Record<string, unknown>) => AsyncIterable<Record<string, unknown>>) | undefined
  if (typeof queryFn !== 'function') {
    yield { type: 'error', message: 'Claude SDK: query() not found — check package version' }
    return
  }

  const queryOpts: Record<string, unknown> = {
    prompt,
    options: {
      includePartialMessages: true,
      dangerouslySkipPermissions: true,
      cwd: opts.targetPath,
      ...(modelId && modelId !== 'default' ? { model: modelId } : {}),
    },
  }

  // Per-block text accumulator: index → accumulated text so far
  // Used to buffer streaming text and extract findings when the block completes.
  const blockText = new Map<number, string>()

  try {
    for await (const message of queryFn(queryOpts)) {
      if (message.type === 'stream_event') {
        yield* extractPartialEvent(message, blockText)
        continue
      }

      // Final assistant message — only extract tool results from user messages
      // and any non-streamed content. Text blocks were already handled via stream_event.
      if (message.type === 'user') {
        yield* extractUserMessage(message)
        continue
      }

      if (message.type === 'result') {
        if ((message as Record<string, unknown>).subtype === 'success') {
          yield { type: 'done' }
          return
        }
        if ((message as Record<string, unknown>).subtype === 'error') {
          const errMsg = typeof (message as Record<string, unknown>).result === 'string'
            ? (message as Record<string, unknown>).result as string
            : 'Claude SDK error'
          yield { type: 'error', message: errMsg }
          return
        }
      }

      // SDKAuthStatusMessage — surface auth failures immediately
      if (message.type === 'auth_status') {
        const msg = message as Record<string, unknown>
        if (!msg.isAuthenticating && msg.error) {
          yield { type: 'error', message: `Claude auth error: ${String(msg.error)}` }
          return
        }
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: `Claude SDK scan failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
    return
  }

  yield { type: 'done' }
}

/**
 * Handle SDKPartialAssistantMessage (type: 'stream_event').
 *
 * Routes each BetaRawMessageStreamEvent to the right ProviderEvent:
 * - content_block_start with tool_use → tool_call
 * - content_block_delta thinking_delta → thinking (live)
 * - content_block_delta text_delta → buffer text (emit findings on stop)
 * - content_block_stop → parse buffered text as findings
 */
function* extractPartialEvent(
  message: Record<string, unknown>,
  blockText: Map<number, string>,
): Generator<ProviderEvent> {
  const evt = message.event as Record<string, unknown> | undefined
  if (!evt) return

  const evtType = evt.type as string | undefined

  if (evtType === 'content_block_start') {
    const idx = evt.index as number | undefined
    const block = evt.content_block as Record<string, unknown> | undefined
    if (!block) return

    if (block.type === 'tool_use') {
      yield {
        type: 'tool_call',
        toolName: String(block.name ?? 'unknown'),
        toolCallId: String(block.id ?? ''),
        input: {},
      }
    }

    if (block.type === 'text' && typeof idx === 'number') {
      blockText.set(idx, '')
    }

    if (block.type === 'thinking' && typeof idx === 'number') {
      blockText.set(idx, '')
    }
    return
  }

  if (evtType === 'content_block_delta') {
    const idx = evt.index as number | undefined
    const delta = evt.delta as Record<string, unknown> | undefined
    if (!delta) return

    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
      const prev = typeof idx === 'number' ? (blockText.get(idx) ?? '') : ''
      if (typeof idx === 'number') blockText.set(idx, prev + delta.thinking)
      yield { type: 'thinking', text: delta.thinking, format: 'plain' }
      return
    }

    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
      const prev = typeof idx === 'number' ? (blockText.get(idx) ?? '') : ''
      if (typeof idx === 'number') blockText.set(idx, prev + delta.text)
      // Don't emit partial text — it's partial JSON finding lines. Parse at block_stop.
      return
    }
    return
  }

  if (evtType === 'content_block_stop') {
    const idx = evt.index as number | undefined
    if (typeof idx !== 'number') return

    const accumulated = blockText.get(idx) ?? ''
    blockText.delete(idx)

    if (!accumulated) return

    // Parse each line as a potential finding or response event
    for (const line of accumulated.split('\n')) {
      const t = line.trim()
      if (t) yield textLineToEvent(t)
    }
    return
  }
}

/**
 * Extract ProviderEvents from a user message (tool results).
 * tool_result blocks have: type, tool_use_id, content (string | ContentBlock[]).
 */
function* extractUserMessage(
  message: Record<string, unknown>,
): Generator<ProviderEvent> {
  const msg = message.message as Record<string, unknown> | undefined
  if (!msg?.content || !Array.isArray(msg.content)) return

  for (const block of msg.content as Array<Record<string, unknown>>) {
    if (block.type !== 'tool_result') continue
    const toolCallId = String(block.tool_use_id ?? '')
    const rawContent = block.content
    const output = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? (rawContent as Array<Record<string, unknown>>)
            .filter((c) => c.type === 'text')
            .map((c) => String(c.text ?? ''))
            .join('\n')
        : ''
    if (toolCallId) {
      yield { type: 'tool_result', toolCallId, output, isError: false }
    }
  }
}
