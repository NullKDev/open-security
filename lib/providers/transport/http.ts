import type { ProviderEvent } from '../index'
import { textLineToEvent } from '../shared/line-parser'

const OLLAMA_BASE_URL = 'http://localhost:11434'

/**
 * Probe whether the Ollama daemon is running.
 * Returns true if /api/version responds with an OK status.
 */
export async function probeOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Execute an Ollama security scan via streaming HTTP API.
 *
 * Probes /api/version before scanning; yields a user-readable ErrorEvent if
 * the daemon is not running. Buffers streaming text response and parses each
 * complete line as a security finding (JSON) or thinking/progress event.
 */
export async function* ollamaHttpScan(
  modelId: string,
  prompt: string,
): AsyncIterable<ProviderEvent> {
  const alive = await probeOllama()
  if (!alive) {
    yield {
      type: 'error',
      message: 'Ollama daemon is not running. Start it with: ollama serve',
    }
    return
  }

  let response: Response
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId || 'llama3',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
    })
  } catch (err) {
    yield {
      type: 'error',
      message: `Ollama request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
    return
  }

  if (!response.ok) {
    yield { type: 'error', message: `Ollama HTTP error ${response.status}` }
    return
  }

  const body = response.body
  if (!body) {
    yield { type: 'done' }
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rawBuffer = ''
  let textBuffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      rawBuffer += decoder.decode(value, { stream: true })
      const lines = rawBuffer.split('\n')
      rawBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let obj: Record<string, unknown>
        try {
          obj = JSON.parse(trimmed) as Record<string, unknown>
        } catch {
          continue
        }

        // Ollama streaming format: {"message":{"role":"assistant","content":"..."},"done":false}
        const msg = obj.message as Record<string, unknown> | undefined
        if (typeof msg?.content === 'string' && msg.content.length > 0) {
          textBuffer += msg.content
          const completedLines = textBuffer.split('\n')
          textBuffer = completedLines.pop() ?? ''
          for (const textLine of completedLines) {
            const t = textLine.trim()
            if (t) yield textLineToEvent(t)
          }
        }

        if (obj.done === true) {
          if (textBuffer.trim()) yield textLineToEvent(textBuffer.trim())
          yield { type: 'done' }
          return
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (textBuffer.trim()) yield textLineToEvent(textBuffer.trim())
  yield { type: 'done' }
}
