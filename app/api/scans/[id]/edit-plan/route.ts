/**
 * POST /api/scans/[id]/edit-plan
 *
 * Edits a specific step in the running scan's plan.
 *
 * Body: `{ stepIndex: number, newContent: string }`
 *
 * Status codes:
 * - 202 — plan edit enqueued
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
  stepIndex: z.number().int().nonnegative(),
  newContent: z.string().min(1, 'newContent must be a non-empty string'),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Records a `plan_edit` scan event and enqueues a turn describing the edit
 * so the running agent can incorporate the change.
 *
 * @param req - Incoming POST request with `{ stepIndex, newContent }` body
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

  const { stepIndex, newContent } = parsed.data

  // Record the plan edit as a scan event
  insertScanEvent(db, scanId, { type: 'plan_edit', stepIndex, newContent })

  // Enqueue a turn summarising the edit for the live agent
  const content = `[Plan edit] Step ${stepIndex}: ${newContent}`
  PendingTurnQueue.forScan(scanId).enqueue({ kind: 'inject', content })

  return NextResponse.json({ ok: true }, { status: 202 })
}
