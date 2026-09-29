/**
 * POST /api/scans/[id]/inject-prompt
 *
 * Injects a user prompt into a running scan.
 *
 * Body: `{ content: string }`
 *
 * Status codes:
 * - 202 — injection enqueued
 * - 400 — invalid body
 * - 404 — scan not found
 * - 409 — scan is not running
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getScanById } from '@/lib/repos/scans.repo'
import { insertScanEvent } from '@/lib/repos/scan-events.repo'
import * as PendingTurnQueue from '@/lib/providers/transport/pending-turn-queue'

const bodySchema = z.object({
  content: z.string().min(1, 'content must be a non-empty string'),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Injects a user prompt into a running scan's turn queue and records
 * a `user_injection` scan event.
 *
 * @param req - Incoming POST request with `{ content }` body
 * @param context - Next.js route context with scan id
 * @returns 202 on success, 400/404/409 on error
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
  const scan = getScanById(db, scanId)
  if (!scan) {
    return NextResponse.json({ error: `Scan ${scanId} not found` }, { status: 404 })
  }
  if (scan.status !== 'running') {
    return NextResponse.json(
      { error: `Scan ${scanId} is not running (status: ${scan.status})` },
      { status: 409 },
    )
  }

  const { content } = parsed.data

  // Record the injection as a scan event (for replay/audit)
  insertScanEvent(db, scanId, { type: 'user_injection', content })

  // Enqueue the turn for the live session
  PendingTurnQueue.forScan(scanId).enqueue({ kind: 'inject', content })

  return NextResponse.json({ ok: true }, { status: 202 })
}
