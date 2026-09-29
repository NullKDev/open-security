// JSON report generator — pure serialization, no file I/O

export interface JsonScanDTO {
  id: string
  projectId: string
  status: string
  stage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  modelsUsed?: string | null
  error?: string | null
}

export interface JsonFindingDTO {
  id: string
  scanId: string
  detector: string
  severity: string
  confidence: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number | null
  locationCommit?: string | null
  dataFlow?: unknown | null
  patchDiff?: string | null
  patchExplanation?: string | null
  validationPasses?: boolean | null
  validationRationale?: string | null
  fpFiltered?: boolean | null
  tags?: unknown | null
  createdAt?: string
}

export interface JsonReport {
  scan: JsonScanDTO
  findings: JsonFindingDTO[]
}

export function generateJsonReport(
  scan: JsonScanDTO,
  findings: JsonFindingDTO[],
): string {
  const report: JsonReport = { scan, findings }
  return JSON.stringify(report, null, 2)
}
