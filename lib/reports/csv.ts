// CSV report generator

export interface CsvFinding {
  id: string
  title: string
  severity: string
  confidence: number
  locationPath: string
  locationLineStart: number
  detector: string
  validationPasses?: boolean | null
  fpFiltered?: boolean | null
}

const CSV_HEADER = 'id,title,severity,confidence,filePath,lineStart,source,validated,falsePositive'

function escapeCsvField(value: string): string {
  // If the field contains a comma, double-quote, or newline → wrap in quotes and escape inner quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function findingToRow(finding: CsvFinding): string {
  const validated = String(finding.validationPasses ?? false)
  const falsePositive = String(finding.fpFiltered ?? false)

  const fields = [
    escapeCsvField(finding.id),
    escapeCsvField(finding.title),
    escapeCsvField(finding.severity),
    String(finding.confidence),
    escapeCsvField(finding.locationPath),
    String(finding.locationLineStart),
    escapeCsvField(finding.detector),
    validated,
    falsePositive,
  ]

  return fields.join(',')
}

export function generateCsvReport(findings: CsvFinding[]): string {
  if (findings.length === 0) {
    return CSV_HEADER + '\n'
  }

  const rows = findings.map(findingToRow)
  return [CSV_HEADER, ...rows].join('\n') + '\n'
}
