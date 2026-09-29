import { ok, paginated } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { listFindings, countFindings } from '@/lib/repos/findings.repo'
import { ListFindingsSchema } from '@/lib/api/schemas'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawParams = Object.fromEntries(url.searchParams.entries())

  const parsed = ListFindingsSchema.safeParse(rawParams)
  if (!parsed.success) {
    const message = parsed.error.issues.map((e) => e.message).join('; ')
    return fail('INVALID_INPUT', message)
  }

  const { scanId, cursor, limit, severity, fpFiltered } = parsed.data

  const db = getDb()

  const result = listFindings(db, scanId, {
    cursor,
    limit,
    severity,
    fpFiltered,
  })

  const total = countFindings(db, scanId, { severity, fpFiltered })

  return paginated(result.findings, { total, cursor: result.nextCursor ?? undefined })
}
