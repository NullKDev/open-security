/**
 * GET /api/scans/[id]/sarif
 *
 * Stream SARIF 2.1.0 JSON for a completed scan.
 *
 * Returns HTTP 500 if the generated SARIF fails internal validation (schema guard).
 * Never emits malformed SARIF — prefer a 500 error over a broken JSON export.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getScanById } from '@/lib/repos/scans.repo'
import { listFindings } from '@/lib/repos/findings.repo'
import { emitSarif } from '@/lib/export/sarif/emit'
import type { FindingRow } from '@/lib/export/sarif/emit'
import { fail } from '@/lib/api/errors'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/scans/[id]/sarif
 *
 * Returns a SARIF 2.1.0 JSON document for the specified scan.
 */
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { id: scanId } = await params
  const db = getDb()

  const scan = getScanById(db, scanId)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${scanId} not found`)
  }

  // Fetch all findings (no pagination — SARIF export is all-or-nothing)
  let allFindings: FindingRow[] = []
  let cursor: string | undefined
  let hasMore = true

  while (hasMore) {
    const result = listFindings(db, scanId, { limit: 500, cursor })
    allFindings = [
      ...allFindings,
      ...result.findings.map((f): FindingRow => ({
        id: f.id,
        scanId: f.scanId,
        detector: f.detector,
        severity: f.severity,
        title: f.title,
        description: f.description,
        locationPath: f.locationPath,
        locationLineStart: f.locationLineStart,
        locationLineEnd: f.locationLineEnd,
        dedupKey: f.dedupKey,
      })),
    ]
    cursor = result.nextCursor ?? undefined
    hasMore = cursor !== undefined
  }

  let sarif: ReturnType<typeof emitSarif>
  try {
    sarif = emitSarif({
      findings: allFindings,
      scanId,
      toolName: 'open-security',
      toolVersion: '0.2.0',
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to generate SARIF: ${String(err)}` },
      { status: 500 },
    )
  }

  return NextResponse.json(sarif, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="scan-${scanId}.sarif.json"`,
    },
  })
}
