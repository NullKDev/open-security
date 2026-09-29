import { describe, it, expect } from 'vitest'
import { generateCsvReport } from '@/lib/reports/csv'

interface FixtureFinding {
  id: string
  scanId: string
  detector: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number
  locationCommit?: string
  patchDiff?: string
  validationPasses?: boolean
  validationRationale?: string
  fpFiltered?: boolean
}

function makeFixture(overrides?: Partial<FixtureFinding>): FixtureFinding {
  return {
    id: `finding-${Math.random().toString(36).slice(2, 8)}`,
    scanId: 'scan-abc',
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'AWS Key Exposed',
    description: 'An AWS access key was found in source code.',
    locationPath: 'config/secrets.yaml',
    locationLineStart: 42,
    fpFiltered: false,
    validationPasses: true,
    ...overrides,
  }
}

describe('generateCsvReport', () => {
  it('10 findings → 11 lines (header + 10 data rows)', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFixture({ id: `f${i}`, title: `Finding ${i}` }),
    )
    const csv = generateCsvReport(findings)
    const lines = csv.trim().split('\n')
    expect(lines.length).toBe(11)
  })

  it('header is exactly: id,title,severity,confidence,filePath,lineStart,source,validated,falsePositive', () => {
    const csv = generateCsvReport([])
    const header = csv.trim().split('\n')[0]
    expect(header).toBe('id,title,severity,confidence,filePath,lineStart,source,validated,falsePositive')
  })

  it('source column maps to finding.detector', () => {
    const finding = makeFixture({ id: 'f1', detector: 'semgrep' })
    const csv = generateCsvReport([finding])
    const rows = csv.trim().split('\n')
    expect(rows[1]).toContain('semgrep')
  })

  it('validated column reflects validationPasses as true/false string', () => {
    const passing = makeFixture({ id: 'f1', validationPasses: true })
    const failing = makeFixture({ id: 'f2', validationPasses: false })
    const nulled = makeFixture({ id: 'f3', validationPasses: undefined })

    const csv = generateCsvReport([passing, failing, nulled])
    const rows = csv.trim().split('\n')

    expect(rows[1]).toContain('true')
    expect(rows[2]).toContain('false')
    // undefined validationPasses → false
    expect(rows[3]).toContain('false')
  })

  it('falsePositive column reflects fpFiltered as true/false string', () => {
    const filtered = makeFixture({ id: 'f1', fpFiltered: true })
    const notFiltered = makeFixture({ id: 'f2', fpFiltered: false })

    const csv = generateCsvReport([filtered, notFiltered])
    const rows = csv.trim().split('\n')

    expect(rows[1]).toContain('true')
    expect(rows[2]).toContain('false')
  })

  it('values containing commas are quoted', () => {
    const finding = makeFixture({ id: 'f1', title: 'A title, with comma' })
    const csv = generateCsvReport([finding])
    expect(csv).toContain('"A title, with comma"')
  })

  it('values containing double-quotes have quotes escaped', () => {
    const finding = makeFixture({ id: 'f1', title: 'A title with "quotes"' })
    const csv = generateCsvReport([finding])
    expect(csv).toContain('"A title with ""quotes"""')
  })

  it('empty findings → only the header line', () => {
    const csv = generateCsvReport([])
    const lines = csv.trim().split('\n')
    expect(lines.length).toBe(1)
    expect(lines[0]).toBe('id,title,severity,confidence,filePath,lineStart,source,validated,falsePositive')
  })

  it('confidence is serialized as a number string', () => {
    const finding = makeFixture({ id: 'f1', confidence: 0.75 })
    const csv = generateCsvReport([finding])
    const rows = csv.trim().split('\n')
    expect(rows[1]).toContain('0.75')
  })

  it('lineStart is serialized as a number string', () => {
    const finding = makeFixture({ id: 'f1', locationLineStart: 99 })
    const csv = generateCsvReport([finding])
    const rows = csv.trim().split('\n')
    expect(rows[1]).toContain('99')
  })
})
