/**
 * POST /api/scans/[id]/sarif-import
 *
 * Accept a SARIF 2.1.0 JSON body and ingest findings for the specified scan.
 *
 * Returns:
 *   200 { imported: number, skipped: number, capped: boolean }
 *   404 if scan not found
 *   422 if SARIF is malformed
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getScanById } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { ingestSarif, SarifIngestError } from '@/lib/scanners/sarif'
import { fail } from '@/lib/api/errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

const ImportResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  capped: z.boolean(),
  toolName: z.string(),
})

type ImportResult = z.infer<typeof ImportResultSchema>

/**
 * POST /api/scans/[id]/sarif-import
 *
 * Accepts a SARIF 2.1.0 JSON body. Ingests up to 10,000 findings into the
 * specified scan via the existing findings pipeline.
 *
 * Returns HTTP 422 for malformed SARIF.
 */
export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { id: scanId } = await params
  const db = getDb()

  const scan = getScanById(db, scanId)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${scanId} not found`)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 422 },
    )
  }

  let ingestResult: Awaited<ReturnType<typeof ingestSarif>>
  try {
    ingestResult = ingestSarif(body)
  } catch (err) {
    if (err instanceof SarifIngestError) {
      return NextResponse.json(
        { error: err.message },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: `SARIF ingest error: ${String(err)}` },
      { status: 422 },
    )
  }

  const { findings, capped, toolName } = ingestResult
  let imported = 0
  let skipped = 0

  for (const finding of findings) {
    try {
      insertFinding(db, {
        scanId,
        detector: finding.detector,
        severity: finding.severity,
        confidence: 0.8, // SARIF imports default confidence
        title: finding.title,
        description: finding.description,
        locationPath: finding.locationPath,
        locationLineStart: finding.locationLineStart,
      })
      imported++
    } catch {
      skipped++
    }
  }

  const result: ImportResult = { imported, skipped, capped, toolName }

  return NextResponse.json(result)
}
