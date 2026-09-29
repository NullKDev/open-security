/**
 * GET /api/repos/[id] — get a repo by id
 * PUT /api/repos/[id] — update a repo (watch config)
 * DELETE /api/repos/[id] — delete a repo
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getRepoById, updateRepo, deleteRepo } from '@/lib/repos/repos.repo'

type Params = { params: Promise<{ id: string }> }

const UpdateRepoSchema = z.object({
  name: z.string().min(1).optional(),
  localPath: z.string().min(1).optional(),
  defaultBranch: z.string().optional(),
  watchEnabled: z.boolean().optional(),
  watchInterval: z.string().optional(),
  notifySeverityFloor: z.string().optional(),
  slackWebhookUrlRef: z.string().optional().nullable(),
  webhookProxyUrl: z.string().optional().nullable(),
})

/** Get a repo by id. */
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { id } = await params
  const db = getDb()
  const repo = getRepoById(db, id)
  if (!repo) return fail('NOT_FOUND', `Repo ${id} not found`)
  return ok(repo)
}

/** Update a repo (e.g. watch config). */
export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params
  const db = getDb()

  const repo = getRepoById(db, id)
  if (!repo) return fail('NOT_FOUND', `Repo ${id} not found`)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = UpdateRepoSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', msg)
  }

  const updated = updateRepo(db, id, parsed.data)
  return ok(updated)
}

/** Delete a repo. */
export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  const { id } = await params
  const db = getDb()

  const repo = getRepoById(db, id)
  if (!repo) return fail('NOT_FOUND', `Repo ${id} not found`)

  deleteRepo(db, id)
  return ok({ deleted: true, id })
}
