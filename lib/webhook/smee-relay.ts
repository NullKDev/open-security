/**
 * lib/webhook/smee-relay.ts
 *
 * Connects to a smee.io channel URL via EventSource (SSE) and forwards
 * incoming webhook events to the local webhook endpoint via fetch POST.
 *
 * This avoids the smee-client npm package dependency and uses native
 * browser/Node.js EventSource instead.
 */

/** Logger — re-use console only in dev; production uses the app logger. */
const log = {
  info: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'test') {
      process.stdout.write(`[smee-relay] ${args.join(' ')}\n`)
    }
  },
  error: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write(`[smee-relay] ERROR ${args.join(' ')}\n`)
    }
  },
}

/** Payload received from smee.io SSE stream */
interface SmeeMessage {
  body: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * Connect to a smee.io channel and forward received webhook events to a local
 * HTTP endpoint via POST.
 *
 * @param channelUrl - The smee.io channel URL (e.g. "https://smee.io/abc123")
 * @param localUrl - Local endpoint to forward events to (e.g. "http://localhost:3000/api/webhooks/github")
 * @returns A stop function that closes the EventSource connection
 */
export function startSmeeRelay(channelUrl: string, localUrl: string): () => void {
  const es = new EventSource(channelUrl)

  es.onmessage = (event: MessageEvent) => {
    let msg: SmeeMessage
    try {
      msg = JSON.parse(event.data as string) as SmeeMessage
    } catch (err) {
      log.error('Failed to parse smee message:', err)
      return
    }

    // Forward the webhook payload to the local endpoint
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...Object.fromEntries(
        Object.entries(msg.headers ?? {}).filter(([k]) =>
          k.toLowerCase().startsWith('x-'),
        ),
      ),
    }

    fetch(localUrl, { // user-webhook-fetch — relay to user-configured local endpoint
      method: 'POST',
      headers,
      body: JSON.stringify(msg.body ?? {}),
    }).catch((err) => {
      log.error('Failed to forward smee event to local endpoint:', err)
    })
  }

  es.onerror = (err: Event) => {
    log.error('smee EventSource error:', err)
  }

  log.info(`Relay started: ${channelUrl} → ${localUrl}`)

  return () => {
    es.close()
    log.info('Relay stopped')
  }
}
