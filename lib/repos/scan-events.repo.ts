import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { scanEvents } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import type { ScanEvent } from '@/lib/pipeline/events'

type DB = BetterSQLite3Database<typeof schema>

// permission_request is the only excluded type: it's interactive/transient.
// Replaying it would open the permission dialog for a completed scan.
const SKIP_TYPES: ScanEvent['type'][] = ['permission_request']

// response and thinking arrive as streaming fragments keyed by messageId.
// We accumulate them in memory and flush as one complete row per message
// on the next non-streaming event — keeps the DB clean (1 row per message).
type StreamingType = 'response' | 'thinking'
const STREAMING_TYPES: StreamingType[] = ['response', 'thinking']

interface StreamAccum {
  type: StreamingType
  text: string
  format?: 'markdown' | 'plain'
  messageId?: string
}
const streamAccum = new Map<string, StreamAccum>()

function flushStreaming(db: DB, scanId: string): void {
  for (const [key, accum] of streamAccum) {
    if (!key.startsWith(`${scanId}:`)) continue
    db.insert(scanEvents)
      .values({
        scanId,
        type: accum.type,
        payload: JSON.stringify({
          type: accum.type,
          text: accum.text,
          format: accum.format ?? 'plain',
          ...(accum.messageId ? { messageId: accum.messageId } : {}),
        }),
        createdAt: new Date().toISOString(),
      })
      .run()
    streamAccum.delete(key)
  }
}

export function insertScanEvent(db: DB, scanId: string, event: ScanEvent): void {
  if (SKIP_TYPES.includes(event.type)) return

  if (STREAMING_TYPES.includes(event.type as StreamingType)) {
    const e = event as { type: StreamingType; text: string; format?: 'markdown' | 'plain'; messageId?: string }
    const key = `${scanId}:${e.type}:${e.messageId ?? 'default'}`
    const existing = streamAccum.get(key)
    if (existing) {
      existing.text += e.text
    } else {
      streamAccum.set(key, { type: e.type, text: e.text, format: e.format, messageId: e.messageId })
    }
    return
  }

  // Non-streaming event: flush any accumulated text for this scan, then save.
  flushStreaming(db, scanId)

  db.insert(scanEvents)
    .values({
      scanId,
      type: event.type,
      payload: JSON.stringify(event),
      createdAt: new Date().toISOString(),
    })
    .run()
}

export function listScanEvents(db: DB, scanId: string): ScanEvent[] {
  const rows = db
    .select()
    .from(scanEvents)
    .where(eq(scanEvents.scanId, scanId))
    .orderBy(scanEvents.id)
    .all()

  return rows.map((row) => JSON.parse(row.payload) as ScanEvent)
}
