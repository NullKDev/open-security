/**
 * POST /api/scans/[id]/reject-tool
 *
 * Rejects a pending tool call in a running scan.
 *
 * Body: `{ toolCallId: string, reason?: string }`
 *
 * Status codes:
 * - 202 — tool rejection enqueued
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
  toolCallId: z.string().min(1, 'toolCallId must be a non-empty string'),
  reason: z.string().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Records a `tool_call_rejected` scan event and enqueues a denial turn
 * so the agent can try an alternative approach.
 *
 * @param req - Incoming POST request with `{ toolCallId, reason? }` body
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

  const { toolCallId, reason } = parsed.data

  // Record the rejection as a scan event
  insertScanEvent(db, scanId, { type: 'tool_call_rejected', toolCallId, reason })

  // Enqueue a turn describing the rejection to the live agent
  const content = reason
    ? `[Tool rejected] ${toolCallId}: ${reason}`
    : `[Tool rejected] ${toolCallId}`
  PendingTurnQueue.forScan(scanId).enqueue({ kind: 'inject', content })

  return NextResponse.json({ ok: true }, { status: 202 })
}
