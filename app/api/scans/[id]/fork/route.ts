/**
 * POST /api/scans/[id]/fork
 *
 * Forks a running scan by copying its events to a new child scan.
 *
 * Body: `{ forkEventId?: string }` — if provided, only events up to (and including)
 * this event id are copied; otherwise all events are copied.
 *
 * Status codes:
 * - 202 `{ childScanId }` — fork created
 * - 400 — invalid body
 * - 404 — scan not found
 * - 409 — scan is not running
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { getScanById, createScan } from '@/lib/repos/scans.repo'
import { createFork } from '@/lib/repos/scan-forks.repo'
import { insertScanEvent } from '@/lib/repos/scan-events.repo'
import { scanEvents } from '@/lib/db/schema'
import type { ScanEvent } from '@/lib/pipeline/events'

const bodySchema = z.object({
  forkEventId: z.string().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Creates a fork of the given running scan.
 *
 * Steps:
 * 1. Validate parent scan exists and is running.
 * 2. Create a child scan (inherits projectId + scanMode from parent).
 * 3. Copy scan events from parent to child (up to forkEventId if provided).
 * 4. Insert a `fork_point` event into the parent scan's event log.
 * 5. Create a `scan_forks` record linking parent to child.
 *
 * @param req - Incoming POST request with optional `{ forkEventId }` body
 * @param context - Next.js route context with scan id
 * @returns 202 `{ childScanId }` on success, 400/404/409 on error
 */
export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id: scanId } = await context.params

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const db = getDb()
  const parentScan = getScanById(db, scanId)
  if (!parentScan) {
    return NextResponse.json({ error: `Scan ${scanId} not found` }, { status: 404 })
  }
  if (parentScan.status !== 'running') {
    return NextResponse.json(
      { error: `Scan ${scanId} is not running (status: ${parentScan.status})` },
      { status: 409 },
    )
  }

  const { forkEventId } = parsed.data

  // Create the child scan (inherits project and mode from parent)
  const childScan = createScan(db, {
    projectId: parentScan.projectId,
    parentId: scanId,
    scanMode: parentScan.scanMode,
    prompt: parentScan.prompt ?? undefined,
    strategy: parentScan.strategy,
  })

  // Copy events from parent → child
  const parentEvents = db
    .select()
    .from(scanEvents)
    .where(eq(scanEvents.scanId, scanId))
    .orderBy(scanEvents.id)
    .all()

  // If forkEventId is provided, only copy up to (and including) that event
  const eventsToCopy = forkEventId
    ? (() => {
        const cutoffIdx = parentEvents.findIndex(
          (e) => String(e.id) === forkEventId,
        )
        return cutoffIdx >= 0 ? parentEvents.slice(0, cutoffIdx + 1) : parentEvents
      })()
    : parentEvents

  for (const evt of eventsToCopy) {
    db.insert(scanEvents)
      .values({
        scanId: childScan.id,
        type: evt.type,
        payload: evt.payload,
        createdAt: evt.createdAt,
        isReplay: 1,
        injectionSource: evt.injectionSource,
      })
      .run()
  }

  // Record fork_point event in parent
  const forkId = randomUUID()
  insertScanEvent(db, scanId, {
    type: 'fork_point',
    forkId,
    parentScanId: scanId,
  })

  // Create the fork relationship record
  createFork(db, {
    id: forkId,
    parentScanId: scanId,
    childScanId: childScan.id,
    forkEventId: forkEventId ?? null,
  })

  return NextResponse.json({ childScanId: childScan.id }, { status: 202 })
}
