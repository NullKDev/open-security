import { describe, it, expect } from 'vitest'
import { generateJsonReport } from '@/lib/reports/json'
import type { JsonScanDTO, JsonFindingDTO } from '@/lib/reports/json'

function makeScan(overrides?: Partial<JsonScanDTO>): JsonScanDTO {
  return {
    id: 'scan-abc',
    projectId: 'proj-xyz',
    status: 'done',
    stage: 'complete',
    startedAt: '2025-01-01T00:00:00Z',
    finishedAt: '2025-01-01T00:05:00Z',
    modelsUsed: 'claude,gemini',
    ...overrides,
  }
}

function makeFinding(overrides?: Partial<JsonFindingDTO>): JsonFindingDTO {
  return {
    id: `finding-${Math.random().toString(36).slice(2, 8)}`,
    scanId: 'scan-abc',
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'Hardcoded Secret',
    description: 'An AWS access key was found.',
    locationPath: 'src/config.ts',
    locationLineStart: 42,
    fpFiltered: false,
    createdAt: '2025-01-01T00:01:00Z',
    ...overrides,
  }
}

describe('generateJsonReport', () => {
  it('produces valid JSON string', () => {
    const scan = makeScan()
    const findings = [makeFinding()]
    const result = generateJsonReport(scan, findings)

    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('includes scan metadata', () => {
    const scan = makeScan()
    const findings = [makeFinding()]
    const result = generateJsonReport(scan, findings)
    const parsed = JSON.parse(result)

    expect(parsed.scan).toBeDefined()
    expect(parsed.scan.id).toBe('scan-abc')
    expect(parsed.scan.status).toBe('done')
  })

  it('includes findings array', () => {
    const scan = makeScan()
    const findings = [makeFinding(), makeFinding(), makeFinding()]
    const result = generateJsonReport(scan, findings)
    const parsed = JSON.parse(result)

    expect(Array.isArray(parsed.findings)).toBe(true)
    expect(parsed.findings.length).toBe(3)
  })

  it('handles empty findings array', () => {
    const scan = makeScan()
    const result = generateJsonReport(scan, [])
    const parsed = JSON.parse(result)

    expect(parsed.findings).toEqual([])
    expect(parsed.scan).toBeDefined()
  })

  it('finding has all expected fields', () => {
    const scan = makeScan()
    const finding = makeFinding()
    const result = generateJsonReport(scan, [finding])
    const parsed = JSON.parse(result)
    const f = parsed.findings[0]

    expect(f.id).toBe(finding.id)
    expect(f.detector).toBe('gitleaks')
    expect(f.severity).toBe('high')
    expect(f.confidence).toBe(0.95)
    expect(f.title).toBe('Hardcoded Secret')
    expect(f.locationPath).toBe('src/config.ts')
    expect(f.locationLineStart).toBe(42)
  })

  it('is pretty-printed with 2-space indentation', () => {
    const scan = makeScan()
    const findings = [makeFinding()]
    const result = generateJsonReport(scan, findings)

    expect(result).toContain('  "scan"')
    expect(result).toContain('  "findings"')
  })
})
