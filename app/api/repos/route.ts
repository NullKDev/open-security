/**
 * GET /api/repos — list all tracked repos
 * POST /api/repos — create a new tracked repo
 */
import { z } from 'zod'
import { ok, created } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { listRepos, createRepo } from '@/lib/repos/repos.repo'

const CreateRepoSchema = z.object({
  name: z.string().min(1),
  localPath: z.string().min(1),
  defaultBranch: z.string().default('main'),
  projectId: z.string().optional().nullable(),
  watchEnabled: z.boolean().default(false),
  watchInterval: z.string().default('0 */6 * * *'),
  notifySeverityFloor: z.string().default('high'),
  slackWebhookUrlRef: z.string().optional().nullable(),
})

/** List all tracked repos. */
export async function GET(): Promise<Response> {
  const db = getDb()
  const repos = listRepos(db)
  return ok(repos)
}

/** Create a new tracked repo. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const parsed = CreateRepoSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', msg)
  }

  const db = getDb()
  const repo = createRepo(db, parsed.data)
  return created(repo)
}
