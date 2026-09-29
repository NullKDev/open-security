/**
 * POST /api/findings/[id]/export/jira
 *
 * Export a finding to Jira as an issue.
 * Idempotent: if jira_issue_key is already set, returns the existing key.
 *
 * Response: { ok: true, jiraKey: string }
 * Errors: 404 (finding not found), 500 (export error)
 */
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import { exportToJira } from '@/lib/exporters/jira'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/findings/[id]/export/jira
 *
 * Exports the finding to Jira. Creates a new issue or returns the existing
 * Jira key if already exported (idempotent).
 *
 * @param _request - Incoming HTTP request (body unused)
 * @param context - Route context containing finding ID
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()

  const finding = getFindingById(db, id)
  if (!finding) {
    return fail('NOT_FOUND', `Finding ${id} not found`)
  }

  try {
    const jiraKey = await exportToJira(id, db)
    return ok({ ok: true, jiraKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', message)
  }
}
