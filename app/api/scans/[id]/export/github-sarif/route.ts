/**
 * POST /api/scans/[id]/export/github-sarif
 *
 * Upload a scan's findings to GitHub Code Scanning as a SARIF 2.1.0 report.
 * Gzip-compresses and base64-encodes the SARIF before uploading.
 * Polls until GitHub confirms processing is complete (5-minute cap).
 *
 * Response: { ok: true, uploadId: string }
 * Errors: 404 (scan not found), 500 (upload error)
 */
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getScanById } from '@/lib/repos/scans.repo'
import { uploadSarif } from '@/lib/exporters/github-code-scanning'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/scans/[id]/export/github-sarif
 *
 * Generates SARIF from scan findings and uploads to GitHub Code Scanning.
 *
 * @param _request - Incoming HTTP request (body unused)
 * @param context - Route context containing scan ID
 */
export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()

  const scan = getScanById(db, id)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${id} not found`)
  }

  try {
    const uploadId = await uploadSarif(id, db)
    return ok({ ok: true, uploadId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', message)
  }
}
