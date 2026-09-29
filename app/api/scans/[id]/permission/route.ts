import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPermissionBridge } from '@/lib/providers/transport/permission-bridge'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  /** Optional: when denying, inject this as a redirect turn in the scan's turn queue */
  redirectInstruction: z.string().optional(),
})

// ---------------------------------------------------------------------------
// POST /api/scans/[id]/permission
// ---------------------------------------------------------------------------

/**
 * Resolve or reject a pending ACP permission request.
 *
 * Body: `{ requestId: string, approved: boolean }`
 *
 * Status codes:
 * - 200 `{ ok: true }` — request resolved successfully
 * - 400 — malformed body (missing fields, wrong types)
 * - 404 — unknown or expired requestId (already timed out, wrong scan, etc.)
 *
 * The PermissionBridge handles same-origin enforcement internally:
 * if the requestId belongs to a different scan, resolveRequest returns false
 * and the route responds with 404.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: scanId } = await params

  // Parse and validate the JSON body
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { requestId, approved, redirectInstruction } = parsed.data

  // Delegate to the singleton PermissionBridge
  const bridge = getPermissionBridge()
  const resolved = bridge.resolveRequest(scanId, requestId, approved, redirectInstruction)

  if (!resolved) {
    return NextResponse.json(
      { error: 'Unknown or expired request' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true })
}
