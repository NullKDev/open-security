/**
 * tests/unit/sarif/emitter.test.ts
 *
 * TDD: T-F01 — SARIF emitter
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { emitSarif } from '@/lib/export/sarif/emit'
import type { FindingRow } from '@/lib/export/sarif/emit'

function makeFind(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f-1',
    scanId: 'scan-1',
    detector: 'gitleaks',
    severity: 'high',
    title: 'AWS Secret Key Exposed',
    description: 'An AWS secret key was found in the source code.',
    locationPath: 'src/config.ts',
    locationLineStart: 42,
    locationLineEnd: 42,
    dedupKey: 'abc123',
    ...overrides,
  }
}

describe('emitSarif', () => {
  it('exports emitSarif as a function', () => {
    expect(typeof emitSarif).toBe('function')
  })

  it('produces a valid SARIF 2.1.0 document structure', () => {
    const sarif = emitSarif({ findings: [], scanId: 'scan-1', toolName: 'open-security' })
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.$schema).toContain('sarif')
    expect(Array.isArray(sarif.runs)).toBe(true)
    expect(sarif.runs).toHaveLength(1)
  })

  it('maps high severity to SARIF error level', () => {
    const sarif = emitSarif({
      findings: [makeFind({ severity: 'high' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('error')
  })

  it('maps critical severity to SARIF error level', () => {
    const sarif = emitSarif({
      findings: [makeFind({ severity: 'critical' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    const result = sarif.runs[0].results[0]
    expect(result.level).toBe('error')
  })

  it('maps medium severity to SARIF warning level', () => {
    const sarif = emitSarif({
      findings: [makeFind({ severity: 'medium' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    expect(sarif.runs[0].results[0].level).toBe('warning')
  })

  it('maps low severity to SARIF note level', () => {
    const sarif = emitSarif({
      findings: [makeFind({ severity: 'low' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    expect(sarif.runs[0].results[0].level).toBe('note')
  })

  it('maps info severity to SARIF none level', () => {
    const sarif = emitSarif({
      findings: [makeFind({ severity: 'info' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    expect(sarif.runs[0].results[0].level).toBe('none')
  })

  it('includes dual fingerprints: obt/v0.1/dedupKey and obt/sarif/primaryLocationLineHash', () => {
    const sarif = emitSarif({
      findings: [makeFind({ dedupKey: 'abc123' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    const result = sarif.runs[0].results[0]
    expect(result.partialFingerprints).toBeDefined()
    expect(result.partialFingerprints!['obt/v0.1/dedupKey']).toBe('abc123')
    expect(result.partialFingerprints!['obt/sarif/primaryLocationLineHash']).toBeDefined()
  })

  it('includes location with uri and startLine', () => {
    const sarif = emitSarif({
      findings: [makeFind({ locationPath: 'src/auth.ts', locationLineStart: 10 })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    const location = sarif.runs[0].results[0].locations?.[0]
    expect(location).toBeDefined()
    expect(location!.physicalLocation?.artifactLocation?.uri).toBe('src/auth.ts')
    expect(location!.physicalLocation?.region?.startLine).toBe(10)
  })

  it('sets ruleId from detector:title', () => {
    const sarif = emitSarif({
      findings: [makeFind({ detector: 'semgrep', title: 'SQL Injection' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    expect(sarif.runs[0].results[0].ruleId).toContain('semgrep')
  })

  it('produces valid empty SARIF when findings is empty', () => {
    const sarif = emitSarif({ findings: [], scanId: 'scan-1', toolName: 'open-security' })
    expect(sarif.runs[0].results).toHaveLength(0)
  })

  it('includes message.text from finding description', () => {
    const sarif = emitSarif({
      findings: [makeFind({ description: 'SQL injection vulnerability' })],
      scanId: 'scan-1',
      toolName: 'open-security',
    })
    expect(sarif.runs[0].results[0].message.text).toBe('SQL injection vulnerability')
  })
})
