import path from 'node:path'
import nodeFs from 'node:fs'
import { assertUnder } from '@/lib/security/path-guard'

// ─── Types ────────────────────────────────────────────────────

export interface ReportFinding {
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
  dataFlow?: string | null
  patchDiff?: string | null
  patchExplanation?: string | null
  validationPasses?: boolean | null
  validationRationale?: string | null
  fpFiltered?: boolean | null
  tags?: string | null
  createdAt?: string
}

export interface InjectableFs {
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void
  writeFileSync: (p: string, content: string, opts?: { encoding?: string }) => void
}

export interface MarkdownReportOpts {
  fs?: InjectableFs
}

// ─── Data-flow mermaid rendering ─────────────────────────────

interface DataFlowGraph {
  nodes?: string[]
  edges?: [string, string][]
}

function renderMermaid(dataFlow: string | null | undefined): string {
  if (!dataFlow) {
    return '```mermaid\ngraph TD\n    A[Source] --> B[Sink]\n```'
  }

  try {
    const parsed = JSON.parse(dataFlow) as DataFlowGraph
    const nodes = parsed.nodes ?? []
    const edges = parsed.edges ?? []

    if (nodes.length === 0 && edges.length === 0) {
      return '```mermaid\ngraph TD\n    A[Source] --> B[Sink]\n```'
    }

    const lines: string[] = ['```mermaid', 'graph TD']

    // Declare each node with a label
    for (const node of nodes) {
      const safeId = node.replace(/[^a-zA-Z0-9_]/g, '_')
      lines.push(`    ${safeId}[${node}]`)
    }

    // Add edges
    for (const [from, to] of edges) {
      const safeFrom = from.replace(/[^a-zA-Z0-9_]/g, '_')
      const safeTo = to.replace(/[^a-zA-Z0-9_]/g, '_')
      lines.push(`    ${safeFrom} --> ${safeTo}`)
    }

    lines.push('```')
    return lines.join('\n')
  } catch {
    return '```mermaid\ngraph TD\n    A[Source] --> B[Sink]\n```'
  }
}

// ─── Per-finding detail page ──────────────────────────────────

function renderFindingDetail(finding: ReportFinding): string {
  const lines: string[] = []

  // YAML front-matter
  lines.push('---')
  lines.push(`id: ${finding.id}`)
  lines.push(`detector: ${finding.detector}`)
  lines.push(`severity: ${finding.severity}`)
  lines.push(`confidence: ${finding.confidence}`)
  lines.push('---')
  lines.push('')

  // Title
  lines.push(`# ${finding.title}`)
  lines.push('')

  // Location
  lines.push('## Location')
  lines.push('')
  lines.push(`- **File**: \`${finding.locationPath}\``)
  lines.push(`- **Line**: ${finding.locationLineStart}${finding.locationLineEnd && finding.locationLineEnd !== finding.locationLineStart ? `–${finding.locationLineEnd}` : ''}`)
  if (finding.locationCommit) {
    lines.push(`- **Commit**: \`${finding.locationCommit}\``)
  }
  lines.push('')

  // Description
  if (finding.description) {
    lines.push('## Description')
    lines.push('')
    lines.push(finding.description)
    lines.push('')
  }

  // Data flow
  lines.push('## Data Flow')
  lines.push('')
  lines.push(renderMermaid(finding.dataFlow))
  lines.push('')

  // Patch diff
  if (finding.patchDiff) {
    lines.push('## Suggested Patch')
    lines.push('')
    lines.push('```diff')
    lines.push(finding.patchDiff)
    lines.push('```')
    lines.push('')
  }

  // Patch explanation
  if (finding.patchExplanation) {
    lines.push('## Patch Explanation')
    lines.push('')
    lines.push(finding.patchExplanation)
    lines.push('')
  }

  // Validation
  if (finding.validationRationale) {
    lines.push('## Validation Rationale')
    lines.push('')
    const passLabel = finding.validationPasses == null
      ? 'Unknown'
      : finding.validationPasses ? 'Pass' : 'Fail'
    lines.push(`**Status**: ${passLabel}`)
    lines.push('')
    lines.push(finding.validationRationale)
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Summary stats ────────────────────────────────────────────

function countBySeverity(findings: ReportFinding[]): Record<string, number> {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
  for (const f of findings) {
    const key = f.severity.toLowerCase()
    if (key in counts) {
      counts[key]++
    } else {
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

// ─── Root report.md ──────────────────────────────────────────

export function renderReport(scanId: string, findings: ReportFinding[]): string {
  const now = new Date().toISOString()
  const lines: string[] = []

  // Front-matter
  lines.push('---')
  lines.push(`scanId: ${scanId}`)
  lines.push(`generatedAt: ${now}`)
  lines.push('---')
  lines.push('')

  // Title
  lines.push(`# Security Report — ${scanId}`)
  lines.push('')
  lines.push(`Generated: ${now}`)
  lines.push('')

  if (findings.length === 0) {
    lines.push('## Findings')
    lines.push('')
    lines.push('No findings detected in this scan.')
    lines.push('')
    return lines.join('\n')
  }

  // Summary stats table
  const counts = countBySeverity(findings)
  lines.push('## Summary')
  lines.push('')
  lines.push('| Severity | Count |')
  lines.push('| --- | --- |')
  for (const [severity, count] of Object.entries(counts)) {
    if (count > 0) {
      lines.push(`| ${severity} | ${count} |`)
    }
  }
  lines.push('')

  // Findings table
  lines.push('## Findings')
  lines.push('')
  lines.push('| Severity | Title | Location | Detail |')
  lines.push('| --- | --- | --- | --- |')

  for (const finding of findings) {
    const location = `${finding.locationPath}:${finding.locationLineStart}`
    const link = `[View](findings/${finding.id}.md)`
    lines.push(`| ${finding.severity} | ${finding.title} | ${location} | ${link} |`)
  }

  lines.push('')
  return lines.join('\n')
}

// ─── Main export ──────────────────────────────────────────────

export async function generateMarkdownReport(
  scanId: string,
  findings: ReportFinding[],
  outputDir: string,
  opts: MarkdownReportOpts = {},
): Promise<void> {
  const fsImpl: InjectableFs = opts.fs ?? {
    mkdirSync: (p, o) => nodeFs.mkdirSync(p, o),
    writeFileSync: (p, c) => nodeFs.writeFileSync(p, c, 'utf-8'),
  }

  const reportRoot = path.join(outputDir, scanId)
  const findingsDir = path.join(reportRoot, 'findings')

  // Validate paths (only when using real fs — injectable fs uses fake paths)
  if (!opts.fs) {
    assertUnder(outputDir, reportRoot)
    assertUnder(outputDir, findingsDir)
  }

  // Create directories
  fsImpl.mkdirSync(findingsDir, { recursive: true })

  // Write report.md
  const reportContent = renderReport(scanId, findings)
  fsImpl.writeFileSync(path.join(reportRoot, 'report.md'), reportContent)

  // Write per-finding detail files
  for (const finding of findings) {
    const detailContent = renderFindingDetail(finding)
    const detailPath = path.join(findingsDir, `${finding.id}.md`)
    fsImpl.writeFileSync(detailPath, detailContent)
  }

  // Write meta.json
  const meta = {
    scanId,
    generatedAt: new Date().toISOString(),
    findingCount: findings.length,
    format: 'md',
  }
  fsImpl.writeFileSync(path.join(reportRoot, 'meta.json'), JSON.stringify(meta, null, 2))
}
