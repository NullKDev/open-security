import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getScanById } from '@/lib/repos/scans.repo'
import { listFindings } from '@/lib/repos/findings.repo'
import { renderReport, type ReportFinding } from '@/lib/reports/md'
import { generateJsonReport, type JsonScanDTO, type JsonFindingDTO } from '@/lib/reports/json'
import { generateSarifReport, type SarifFinding } from '@/lib/reports/sarif'
import { generateCsvReport, type CsvFinding } from '@/lib/reports/csv'

interface RouteContext {
  params: Promise<{ scanId: string }>
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { scanId } = await context.params
  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'json'

  if (!['md', 'json', 'sarif', 'csv'].includes(format)) {
    return fail('INVALID_INPUT', `Unsupported format: ${format}. Use md, json, sarif, or csv.`)
  }

  const db = getDb()

  const scan = getScanById(db, scanId)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${scanId} not found`)
  }

  const { findings } = listFindings(db, scanId, { limit: 10000 })

  try {
    switch (format) {
      case 'md': {
        const mdFindings: ReportFinding[] = findings.map((f) => ({
          ...f,
          dataFlow: typeof f.dataFlow === 'string' ? f.dataFlow : null,
          tags: typeof f.tags === 'string' ? f.tags : (f.tags ? JSON.stringify(f.tags) : null),
        }))
        const content = renderReport(scanId, mdFindings)
        return new Response(content, {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        })
      }
      case 'json': {
        const scanDTO: JsonScanDTO = {
          id: scan.id,
          projectId: scan.projectId,
          status: scan.status,
          stage: scan.stage,
          startedAt: scan.startedAt,
          finishedAt: scan.finishedAt,
          modelsUsed: scan.modelsUsed,
          error: scan.error,
        }
        const findingDTOs: JsonFindingDTO[] = findings.map((f) => ({
          id: f.id,
          scanId: f.scanId,
          detector: f.detector,
          severity: f.severity,
          confidence: f.confidence,
          title: f.title,
          description: f.description,
          locationPath: f.locationPath,
          locationLineStart: f.locationLineStart,
          locationLineEnd: f.locationLineEnd,
          locationCommit: f.locationCommit,
          dataFlow: f.dataFlow,
          patchDiff: f.patchDiff,
          patchExplanation: f.patchExplanation,
          validationPasses: f.validationPasses,
          validationRationale: f.validationRationale,
          fpFiltered: f.fpFiltered,
          tags: f.tags,
          createdAt: f.createdAt,
        }))
        return new Response(generateJsonReport(scanDTO, findingDTOs), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      }
      case 'sarif': {
        const sarifFindings: SarifFinding[] = findings.map((f) => ({
          id: f.id,
          detector: f.detector,
          severity: f.severity,
          confidence: f.confidence,
          title: f.title,
          description: f.description,
          locationPath: f.locationPath,
          locationLineStart: f.locationLineStart,
          locationLineEnd: f.locationLineEnd ?? undefined,
        }))
        return new Response(generateSarifReport(sarifFindings), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      }
      case 'csv': {
        const csvFindings: CsvFinding[] = findings.map((f) => ({
          id: f.id,
          detector: f.detector,
          severity: f.severity,
          confidence: f.confidence,
          title: f.title,
          description: f.description,
          locationPath: f.locationPath,
          locationLineStart: f.locationLineStart,
          fpFiltered: f.fpFiltered,
        }))
        return new Response(generateCsvReport(csvFindings), {
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        })
      }
    }
  } catch (err) {
    return fail('INTERNAL', `Report generation failed: ${(err as Error).message}`)
  }

  return fail('INTERNAL', 'Unreachable')
}
