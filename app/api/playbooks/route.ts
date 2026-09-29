/**
 * GET /api/playbooks  — list all playbooks (builtins + user-created)
 * POST /api/playbooks — create a new user-defined playbook
 *
 * Both routes are gated behind `OBT_CONSOLE_V2=1`.
 *
 * Status codes (GET):
 * - 200 `{ data: PlaybookRow[] }` — array of all playbooks
 * - 404 — feature flag not enabled
 *
 * Status codes (POST):
 * - 201 `{ data: PlaybookRow }` — created playbook
 * - 400 — Zod validation error
 * - 404 — feature flag not enabled
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { listPlaybooks, upsertPlaybook } from '@/lib/repos/playbooks.repo'

// ---------------------------------------------------------------------------
// Feature-flag guard
// ---------------------------------------------------------------------------

function notEnabled(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

function isEnabled(): boolean {
  return process.env.OBT_CONSOLE_V2 === '1'
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreatePlaybookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  promptTemplate: z.string().min(1, 'promptTemplate is required'),
  description: z.string().optional(),
  scannerScope: z.string().optional(),
  parameters: z.string().optional(),
  source: z.literal('user'),
})

// ---------------------------------------------------------------------------
// GET /api/playbooks
// ---------------------------------------------------------------------------

/**
 * Lists all playbooks (builtins and user-created) from the database.
 * Requires the `OBT_CONSOLE_V2=1` environment variable.
 *
 * @returns 200 with `{ data: PlaybookRow[] }` or 404 if feature is disabled
 */
export async function GET(_req: Request): Promise<NextResponse> {
  if (!isEnabled()) return notEnabled()

  const db = getDb()
  const rows = listPlaybooks(db)
  return NextResponse.json({ data: rows }, { status: 200 })
}

// ---------------------------------------------------------------------------
// POST /api/playbooks
// ---------------------------------------------------------------------------

/**
 * Creates a new user-defined playbook.
 * Requires the `OBT_CONSOLE_V2=1` environment variable.
 * Only `source: 'user'` is accepted — builtin playbooks are read-only.
 *
 * @param req - Incoming POST request with playbook body
 * @returns 201 with `{ data: PlaybookRow }` on success, 400 on validation error
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!isEnabled()) return notEnabled()

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreatePlaybookSchema.safeParse(rawBody)
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { id, name, version, promptTemplate, description, scannerScope, parameters, source } =
    parsed.data

  const now = new Date().toISOString()
  const row = {
    id,
    name,
    version,
    description: description ?? null,
    promptTemplate,
    scannerScope: scannerScope ?? null,
    parameters: parameters ?? null,
    source,
    builtIn: 0,
    trusted: 0,
    createdAt: now,
  }

  const db = getDb()
  upsertPlaybook(db, row)

  return NextResponse.json({ data: row }, { status: 201 })
}
