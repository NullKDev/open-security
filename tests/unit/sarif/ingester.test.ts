/**
 * tests/unit/sarif/ingester.test.ts
 *
 * TDD: T-F04 — SARIF ingester
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { ingestSarif, SarifIngestError } from '@/lib/scanners/sarif'

/** Minimal valid SARIF 2.1.0 document */
function makeSarif(results: unknown[] = []) {
  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: { driver: { name: 'CodeQL', version: '2.12.0' } },
        results,
      },
    ],
  }
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    ruleId: 'js/sql-injection',
    level: 'error',
    message: { text: 'SQL injection vulnerability' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: 'src/db.ts' },
          region: { startLine: 42 },
        },
      },
    ],
    ...overrides,
  }
}

describe('ingestSarif', () => {
  it('exports ingestSarif as a function', () => {
    expect(typeof ingestSarif).toBe('function')
  })

  it('exports SarifIngestError class', () => {
    expect(typeof SarifIngestError).toBe('function')
  })

  it('returns empty array for valid SARIF with no results', () => {
    const result = ingestSarif(makeSarif([]))
    expect(result.findings).toHaveLength(0)
  })

  it('converts a valid SARIF result to a NormalizedFinding', () => {
    const sarif = makeSarif([makeResult()])
    const { findings } = ingestSarif(sarif)
    expect(findings).toHaveLength(1)
    const f = findings[0]
    expect(f.title).toBeTruthy()
    expect(f.locationPath).toBe('src/db.ts')
    expect(f.locationLineStart).toBe(42)
    expect(f.detector).toContain('CodeQL')
  })

  it('maps SARIF error level to high severity', () => {
    const sarif = makeSarif([makeResult({ level: 'error' })])
    const { findings } = ingestSarif(sarif)
    expect(findings[0].severity).toBe('high')
  })

  it('maps SARIF warning level to medium severity', () => {
    const sarif = makeSarif([makeResult({ level: 'warning' })])
    const { findings } = ingestSarif(sarif)
    expect(findings[0].severity).toBe('medium')
  })

  it('maps SARIF note level to low severity', () => {
    const sarif = makeSarif([makeResult({ level: 'note' })])
    const { findings } = ingestSarif(sarif)
    expect(findings[0].severity).toBe('low')
  })

  it('defaults missing level to medium severity', () => {
    const result = makeResult()
    delete (result as Record<string, unknown>).level
    const sarif = makeSarif([result])
    const { findings } = ingestSarif(sarif)
    expect(findings[0].severity).toBe('medium')
  })

  it('enforces 10k cap on findings', () => {
    const results = Array.from({ length: 12000 }, (_, i) =>
      makeResult({ ruleId: `rule-${i}` }),
    )
    const sarif = makeSarif(results)
    const { findings, capped } = ingestSarif(sarif)
    expect(findings).toHaveLength(10000)
    expect(capped).toBe(true)
  })

  it('throws SarifIngestError for malformed input (not an object)', () => {
    expect(() => ingestSarif('not a sarif')).toThrow(SarifIngestError)
  })

  it('throws SarifIngestError when version is missing', () => {
    expect(() =>
      ingestSarif({ runs: [{ tool: { driver: { name: 'X' } }, results: [] }] }),
    ).toThrow(SarifIngestError)
  })

  it('throws SarifIngestError when runs is missing', () => {
    expect(() => ingestSarif({ version: '2.1.0' })).toThrow(SarifIngestError)
  })

  it('handles missing ruleId gracefully (uses empty string)', () => {
    const result = makeResult()
    delete (result as Record<string, unknown>).ruleId
    const sarif = makeSarif([result])
    expect(() => ingestSarif(sarif)).not.toThrow()
  })

  it('handles results with no locations gracefully', () => {
    const result = makeResult()
    delete (result as Record<string, unknown>).locations
    const sarif = makeSarif([result])
    const { findings } = ingestSarif(sarif)
    expect(findings[0].locationPath).toBe('')
    expect(findings[0].locationLineStart).toBe(1)
  })
})
