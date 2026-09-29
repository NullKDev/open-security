import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OBT_ROOT } from '@/lib/config/store'

const TRAFFIC_LOG = join(OBT_ROOT, 'acp-traffic.log')

/**
 * Appends an ndjson entry to the ACP traffic log.
 *
 * Writes asynchronously (fire-and-forget) — never blocks the caller.
 * File write errors are silently suppressed.
 *
 * @param direction - Whether the message was sent or received
 * @param message - The raw message payload to log
 */
export function logTraffic(direction: 'send' | 'recv', message: unknown): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    dir: direction === 'send' ? '→' : '←',
    msg: message,
  })
  appendFile(TRAFFIC_LOG, entry + '\n').catch(() => {})
}
