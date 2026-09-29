import type { ProviderEvent } from '../index'

/** Single source of truth for valid severity labels across all transports. */
export const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])

/**
 * Convert a single LLM text line to a ProviderEvent.
 *
 * Classification priority:
 *   1. JSON with all 4 required finding fields + valid severity → FindingEvent
 *      (false-positive titles and locations are reclassified as ResponseEvent)
 *   2. Lines starting with `[tool]` → ProgressEvent
 *   3. Everything else → ResponseEvent (model prose)
 *
 * Importantly, text NEVER falls through to `thinking` — only native-format
 * handlers (e.g. opencode `reasoning` events) emit `thinking` events.
 * This fixes the double-thinking bug where non-finding text was misclassified.
 *
 * @param line A single trimmed line from the LLM's text output
 */
export function textLineToEvent(line: string): ProviderEvent {
  if (line.startsWith('{')) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (
        typeof obj.title === 'string' && obj.title.trim().length > 0 &&
        typeof obj.description === 'string' && obj.description.trim().length > 0 &&
        typeof obj.severity === 'string' && VALID_SEVERITIES.has(obj.severity) &&
        typeof obj.location === 'string' && obj.location.trim().length > 0
      ) {
        // Reclassify garbage findings — LLM sometimes outputs "no findings"
        // as a JSON object instead of just outputting nothing.
        const loc = obj.location.trim()
        const title = obj.title.trim()
        if (
          loc === 'N/A' || loc === 'n/a' || loc === 'none' || loc === 'unknown' || loc === 'N/A:1' ||
          title.toLowerCase().startsWith('no vulnerabilities') ||
          title.toLowerCase().startsWith('no issues found')
        ) {
          return { type: 'response', text: line, format: 'plain' }
        }
        return {
          type: 'finding',
          title: obj.title as string,
          description: obj.description as string,
          detector: typeof obj.detector === 'string' ? (obj.detector as string) : undefined,
          severity: obj.severity as string,
          location: obj.location as string,
        }
      }
    } catch {
      // not valid JSON — fall through to response
    }
  }

  // Tool calls → progress events
  if (line.startsWith('[tool]')) {
    return { type: 'progress', message: line }
  }

  // Everything else → model prose
  return { type: 'response', text: line, format: 'plain' }
}
