/**
 * SSE Route — GET /api/scans/:id/stream
 *
 * Streams ScanEvents as Server-Sent Events (SSE) for a given scan.
 *
 * On connect:
 *   1a. If bus has buffered events → pipeline is alive: replay buffer + subscribe
 *   1b. If bus is empty → server was restarted: replay from DB instead
 *       - If scan was mid-run when server died: emit an interruption error + close
 *       - If scan already finished (done/error in DB): replay and close
 *   2. Subscribe to new events as they arrive (only when pipeline is alive)
 *   3. Send a heartbeat comment every 15s to keep the connection alive
 *
 * Content-Type: text/event-stream; charset=utf-8
 */
import type { NextRequest } from 'next/server'
import { sharedBus } from '@/lib/pipeline/shared-bus'
import type { ScanBus } from '@/lib/pipeline/scan-bus'
import type { ScanEvent } from '@/lib/pipeline/events'
import { getDb } from '@/lib/db/client'
import { listScanEvents } from '@/lib/repos/scan-events.repo'
import { updateScanStatus } from '@/lib/repos/scans.repo'
import { sanitizeEvent } from '@/lib/pipeline/sanitize-event'

const HEARTBEAT_INTERVAL_MS = 15_000

interface RouteContext {
  params: Promise<{ id: string }>
}

interface GetOpts {
  /** Injected bus for testing — overrides the module-level default */
  bus?: ScanBus
}

export async function GET(
  req: NextRequest | Request,
  context: RouteContext,
  opts?: GetOpts,
): Promise<Response> {
  const { id: scanId } = await context.params
  const bus = opts?.bus ?? sharedBus

  const encoder = new TextEncoder()

  function formatEvent(event: ScanEvent): string {
    return `data: ${JSON.stringify(sanitizeEvent(event))}\n\n`
  }

  function heartbeat(): string {
    return ': heartbeat\n\n'
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      // Stub so cleanup() is always safe to call before unsubscribe is assigned
      let unsubscribe: () => void = () => {}
      let hbTimer: ReturnType<typeof setInterval> | null = null

      function enqueue(text: string): void {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            closed = true
          }
        }
      }

      function cleanup(): void {
        if (closed) return
        closed = true
        if (hbTimer) clearInterval(hbTimer)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }

      req.signal?.addEventListener('abort', cleanup)

      const buffered = bus.replay(scanId)

      if (buffered.length > 0) {
        // ── Pipeline is alive: replay in-memory buffer then subscribe ──────────
        for (const event of buffered) enqueue(formatEvent(event))

        // If `done`/`error` was already in the buffer the bus is about to be
        // destroyed — no new terminal event will arrive via subscribe.
        const lastBuffered = buffered[buffered.length - 1]
        if (lastBuffered.type === 'done' || lastBuffered.type === 'error') {
          cleanup()
          return
        }

        unsubscribe = bus.subscribe(scanId, (event) => {
          enqueue(formatEvent(event))
          if (event.type === 'done' || event.type === 'error') cleanup()
        })

        hbTimer = setInterval(() => {
          if (closed) { cleanup(); return }
          enqueue(heartbeat())
        }, HEARTBEAT_INTERVAL_MS)
      } else {
        // ── Bus is empty: server restarted — fall back to DB ──────────────────
        try {
          const db = getDb()
          const dbEvents = listScanEvents(db, scanId)

          for (const event of dbEvents) enqueue(formatEvent(event))

          const lastType = dbEvents.at(-1)?.type
          const terminated = lastType === 'done' || lastType === 'error'

          if (terminated) {
            // Scan already finished — close the stream now, no need for heartbeats
            cleanup()
            return
          }

          if (dbEvents.length > 0) {
            // Scan was mid-run when server died — mark failed and notify client
            try {
              updateScanStatus(db, scanId, 'failed', 'Server restarted while scan was in progress')
            } catch {
              // Ignore if already failed
            }
            enqueue(formatEvent({
              type: 'error',
              message: 'Scan was interrupted: server was restarted. Re-run the scan to continue.',
            }))
            cleanup()
            return
          }
        } catch {
          // DB unavailable — just keep the connection open with heartbeats
        }

        // No events anywhere — heartbeats keep connection alive until the
        // pipeline starts publishing or the client navigates away
        hbTimer = setInterval(() => {
          if (closed) { cleanup(); return }
          enqueue(heartbeat())
        }, HEARTBEAT_INTERVAL_MS)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
