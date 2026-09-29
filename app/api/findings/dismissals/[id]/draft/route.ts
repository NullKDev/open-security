/**
 * @file app/api/findings/dismissals/[id]/draft/route.ts
 *
 * POST /api/findings/dismissals/[id]/draft
 *
 * Generates an agent-assisted rationale draft for a dismissal.
 * Enforces a 5-second cooldown server-side (REQ-FB-07):
 * if a draft was loaded within the last 5 seconds, returns 400.
 *
 * The draft is recorded in finding_dismissal_history with source='agent-assisted'.
 *
 * Design: v0.4 design.md §4.3, REQ-FB-07, ADR-6
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getDraftCooldownMeta } from '@/lib/repos/dismissals.repo'

interface RouteContext {
  params: Promise<{ id: string }>
}

type SqliteClient = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => void
  }
}

const DraftBodySchema = z.object({
  actor: z.string().min(1, 'actor is required'),
})

const COOLDOWN_SECONDS = 5

/**
 * POST /api/findings/dismissals/[id]/draft
 *
 * Creates an agent-assisted rationale draft for a dismissal.
 * Enforces a 5-second server-side cooldown per REQ-FB-07.
 *
 * Body: { actor: string }
 * Response: 200 with { draft, draftId, draftedAt }
 * Errors:
 *   400 (invalid input)
 *   400 (cooldown-not-elapsed — within 5s of previous draft)
 *   404 (dismissal not found)
 *
 * @param request - Incoming HTTP request
 * @param context - Route context containing dismissal id
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = DraftBodySchema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { actor } = parsed.data
  const db = getDb()

  // Verify dismissal exists
  const sqlite = (db as unknown as { $client: SqliteClient }).$client
  const dismissalRow = sqlite.prepare(
    `SELECT id, reason FROM finding_dismissals WHERE id = ?`
  ).get(id) as { id: string; reason: string } | undefined

  if (!dismissalRow) {
    return fail('NOT_FOUND', `Dismissal ${id} not found`)
  }

  // Check server-side 5-second cooldown (REQ-FB-07)
  const cooldown = getDraftCooldownMeta(db, id)
  if (cooldown && !cooldown.canSubmit) {
    const remaining = Math.ceil(COOLDOWN_SECONDS - (Date.now() - new Date(cooldown.draftedAt).getTime()) / 1000)
    return fail(
      'INVALID_INPUT',
      `Cooldown not elapsed — please wait ${remaining}s before requesting another draft`,
    )
  }

  // Generate the draft (simplified: base the draft on existing reason + context)
  // In production this would call the ACP agent; for now produce a structured draft
  const draftId = crypto.randomUUID()
  const draftedAt = new Date().toISOString()
  const draft = `Agent-assisted draft based on finding context:\n\nOriginal reason: ${dismissalRow.reason}\n\nSuggested rationale: This finding has been reviewed and determined to be a false positive in the context of this codebase. The pattern does not represent an exploitable vulnerability given the runtime constraints and input validation present in the application.`

  // Record in history with source='agent-assisted' (enforces 5s cooldown)
  sqlite.prepare(`
    INSERT INTO finding_dismissal_history
      (id, dismissal_id, action, actor, rationale_snapshot, source, ts)
    VALUES (?, ?, 'created', ?, ?, 'agent-assisted', ?)
  `).run(draftId, id, actor, draft, draftedAt)

  return ok({ draft, draftId, draftedAt })
}
