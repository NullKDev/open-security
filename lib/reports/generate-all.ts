/**
 * generate-all.ts — Persist all report formats to disk after a scan completes.
 *
 * Writes to: <workspaceRoot>/reports/
 *   report.json   — full machine-readable report
 *   report.md     — human-readable Markdown with per-finding detail pages
 *   report.sarif  — SARIF 2.1.0 for IDE/CI integration
 *   report.csv    — spreadsheet-friendly flat list
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { listFindings } from '@/lib/repos/findings.repo'
import { getScanById } from '@/lib/repos/scans.repo'
import { generateJsonReport } from './json'
import { generateMarkdownReport } from './md'
import { generateSarifReport } from './sarif'
import { generateCsvReport } from './csv'
import type { JsonScanDTO, JsonFindingDTO } from './json'
import type { SarifFinding } from './sarif'
import type { CsvFinding } from './csv'
import type { ReportFinding } from './md'

type DB = BetterSQLite3Database<typeof schema>

export async function generateAllReports(
  db: DB,
  scanId: string,
  workspaceRoot: string,
): Promise<void> {
  const reportsDir = path.join(workspaceRoot, 'reports')
  fs.mkdirSync(reportsDir, { recursive: true })

  const scan = getScanById(db, scanId)
  if (!scan) return

  const { findings } = listFindings(db, scanId, { limit: 10_000 })

  // ── JSON ───────────────────────────────────────────────────────────────────
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
    tags: typeof f.tags === 'string' ? f.tags : (f.tags ? JSON.stringify(f.tags) : null),
    createdAt: f.createdAt,
  }))
  fs.writeFileSync(path.join(reportsDir, 'report.json'), generateJsonReport(scanDTO, findingDTOs), 'utf-8')

  // ── Markdown ───────────────────────────────────────────────────────────────
  const mdFindings: ReportFinding[] = findings.map((f) => ({
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
    dataFlow: typeof f.dataFlow === 'string' ? f.dataFlow : null,
    patchDiff: f.patchDiff,
    patchExplanation: f.patchExplanation,
    validationPasses: f.validationPasses,
    validationRationale: f.validationRationale,
    fpFiltered: f.fpFiltered,
    tags: typeof f.tags === 'string' ? f.tags : (f.tags ? JSON.stringify(f.tags) : null),
    createdAt: f.createdAt,
  }))
  await generateMarkdownReport(scanId, mdFindings, reportsDir)

  // ── SARIF ──────────────────────────────────────────────────────────────────
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
  fs.writeFileSync(path.join(reportsDir, 'report.sarif'), generateSarifReport(sarifFindings), 'utf-8')

  // ── CSV ────────────────────────────────────────────────────────────────────
  const csvFindings: CsvFinding[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence,
    locationPath: f.locationPath,
    locationLineStart: f.locationLineStart,
    detector: f.detector,
    validationPasses: f.validationPasses,
    fpFiltered: f.fpFiltered,
  }))
  fs.writeFileSync(path.join(reportsDir, 'report.csv'), generateCsvReport(csvFindings), 'utf-8')
}
