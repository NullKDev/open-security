/**
 * sanitize-event.ts — Strip workspace paths from ScanEvents before sending to the client.
 *
 * The workspace stores files at absolute paths like:
 *   /Users/…/.obt/projects/{UUID}/scans/{UUID}/source/src/main.ts
 *
 * Clients don't need (and shouldn't see) the machine-local prefix.
 * Replace everything up to and including `source/` with `…/`, so the
 * user sees a clean relative path like `…/src/main.ts`.
 *
 * Applied recursively to every string value in the event object so it
 * covers message, path, command, output, input fields without needing
 * to enumerate them individually.
 */

/**
 * Regex that matches the absolute workspace prefix up to the `source` dir.
 *
 * Pattern:  <anything>/.obt/projects/<uuid>/scans/<uuid>/source
 *
 * The trailing slash is optional because some messages end at `source`
 * without a further path segment.
 */
const WORKSPACE_PREFIX_RE =
  /[^\s"'[\]{}]+\/\.obt\/projects\/[0-9a-f-]+\/scans\/[0-9a-f-]+\/source\/?/gi

function sanitizeString(s: string): string {
  return s.replace(WORKSPACE_PREFIX_RE, '…/')
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v)
    }
    return out
  }
  return value
}

/**
 * Returns a deep copy of `event` with all workspace path prefixes replaced.
 * Non-string, non-object values pass through unchanged.
 */
export function sanitizeEvent<T>(event: T): T {
  return sanitizeValue(event) as T
}
