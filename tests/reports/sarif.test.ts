import { describe, it, expect } from 'vitest'
import { generateSarifReport } from '@/lib/reports/sarif'

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
    id: 'finding-1',
    scanId: 'scan-abc',
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'AWS Key Exposed',
    description: 'An AWS access key was found in source code.',
    locationPath: 'config/secrets.yaml',
    locationLineStart: 42,
    ...overrides,
  }
}

describe('generateSarifReport', () => {
  it('output has version: "2.1.0"', () => {
    const sarif = JSON.parse(generateSarifReport([]))
    expect(sarif.version).toBe('2.1.0')
  })

  it('output has $schema field pointing to SARIF 2.1.0', () => {
    const sarif = JSON.parse(generateSarifReport([]))
    expect(sarif.$schema).toContain('sarif-schema-2.1.0')
  })

  it('runs[0].tool.driver.name is "open-security"', () => {
    const sarif = JSON.parse(generateSarifReport([]))
    expect(sarif.runs[0].tool.driver.name).toBe('open-security')
  })

  it('critical finding maps to level "error"', () => {
    const finding = makeFixture({ id: 'f1', severity: 'critical' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('error')
  })

  it('high finding maps to level "error"', () => {
    const finding = makeFixture({ id: 'f1', severity: 'high' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('error')
  })

  it('medium finding maps to level "warning"', () => {
    const finding = makeFixture({ id: 'f1', severity: 'medium' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('warning')
  })

  it('low finding maps to level "note"', () => {
    const finding = makeFixture({ id: 'f1', severity: 'low' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('note')
  })

  it('info finding maps to level "note"', () => {
    const finding = makeFixture({ id: 'f1', severity: 'info' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('note')
  })

  it('result has ruleId matching detector', () => {
    const finding = makeFixture({ id: 'f1', detector: 'semgrep' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.ruleId).toBe('semgrep')
  })

  it('result has message.text containing the finding title', () => {
    const finding = makeFixture({ id: 'f1', title: 'SQL Injection' })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    expect(result.message.text).toContain('SQL Injection')
  })

  it('result locations[0].physicalLocation has file URI and line', () => {
    const finding = makeFixture({ id: 'f1', locationPath: 'src/auth.ts', locationLineStart: 10 })
    const sarif = JSON.parse(generateSarifReport([finding]))
    const result = sarif.runs[0].results[0]
    const physLoc = result.locations[0].physicalLocation
    expect(physLoc.artifactLocation.uri).toContain('src/auth.ts')
    expect(physLoc.region.startLine).toBe(10)
  })

  it('toolVersion is used when provided', () => {
    const sarif = JSON.parse(generateSarifReport([], '0.1.0'))
    expect(sarif.runs[0].tool.driver.version).toBe('0.1.0')
  })

  it('empty findings produces runs[0].results === []', () => {
    const sarif = JSON.parse(generateSarifReport([]))
    expect(sarif.runs[0].results).toEqual([])
  })
})
