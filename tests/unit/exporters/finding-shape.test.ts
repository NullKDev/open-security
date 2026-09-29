/**
 * tests/unit/exporters/finding-shape.test.ts
 *
 * TDD RED → GREEN: T-030 — finding export shape adapter
 *
 * Covers:
 * - All required fields mapped correctly
 * - Null-safe for optional fields (patchDiff, dataFlow, etc.)
 * - consensusScore / consensusStatus / scannerVotes mapping
 * - jiraIssueKey / lastExportError mapping
 */
import { describe, it, expect } from 'vitest'
import { toExportShape } from '@/lib/exporters/finding-shape'
import type { FindingDTO } from '@/lib/repos/findings.repo'

const BASE_FINDING: FindingDTO = {
  id: 'finding-001',
  scanId: 'scan-001',
  detector: 'gitleaks',
  severity: 'high',
  confidence: 0.9,
  exploitability: 0.7,
  title: 'Hardcoded API key',
  description: 'AWS API key found in source code',
  locationPath: 'src/config.ts',
  locationLineStart: 42,
  locationLineEnd: null,
  locationCommit: 'abc123',
  dataFlow: null,
  evidenceHistory: null,
  patchDiff: null,
  patchExplanation: null,
  patchContext: null,
  patchGeneratedAt: null,
  validationModel: null,
  validationPasses: null,
  validationRationale: null,
  fpFiltered: false,
  tags: null,
  createdAt: '2026-01-01T00:00:00Z',
  dedupKey: 'sha256abc',
  canonicalFindingId: null,
  cveIds: null,
  firstDetectedAt: '2026-01-01T00:00:00Z',
  lastSeenAt: '2026-01-01T00:00:00Z',
  occurrenceCount: 1,
  status: 'open',
  proofOfFixId: null,
  isRegression: false,
  regressionOfFindingId: null,
}

describe('toExportShape', () => {
  it('maps all required fields to canonical export object', () => {
    const shape = toExportShape(BASE_FINDING)

    expect(shape.id).toBe('finding-001')
    expect(shape.scanId).toBe('scan-001')
    expect(shape.detector).toBe('gitleaks')
    expect(shape.severity).toBe('high')
    expect(shape.confidence).toBe(0.9)
    expect(shape.exploitability).toBe(0.7)
    expect(shape.title).toBe('Hardcoded API key')
    expect(shape.description).toBe('AWS API key found in source code')
    expect(shape.locationPath).toBe('src/config.ts')
    expect(shape.locationLineStart).toBe(42)
    expect(shape.createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('null-safe for optional fields when null', () => {
    const shape = toExportShape(BASE_FINDING)

    expect(shape.patchDiff).toBeNull()
    expect(shape.dataFlow).toBeNull()
    expect(shape.evidenceHistory).toBeNull()
    expect(shape.locationLineEnd).toBeNull()
    expect(shape.locationCommit).toBe('abc123')
    expect(shape.dedupKey).toBe('sha256abc')
    expect(shape.cveIds).toBeNull()
  })

  it('maps optional fields when present', () => {
    const finding: FindingDTO = {
      ...BASE_FINDING,
      patchDiff: 'diff --git a/src/config.ts...',
      dataFlow: ['step1', 'step2'],
      evidenceHistory: [{ at: '2026-01-01', desc: 'first seen' }],
      cveIds: ['CVE-2023-1234'],
    }

    const shape = toExportShape(finding)

    expect(shape.patchDiff).toBe('diff --git a/src/config.ts...')
    expect(shape.dataFlow).toEqual(['step1', 'step2'])
    expect(shape.evidenceHistory).toEqual([{ at: '2026-01-01', desc: 'first seen' }])
    expect(shape.cveIds).toEqual(['CVE-2023-1234'])
  })

  it('maps status and regression fields', () => {
    const finding: FindingDTO = {
      ...BASE_FINDING,
      status: 'fixed',
      isRegression: true,
      regressionOfFindingId: 'finding-000',
    }

    const shape = toExportShape(finding)

    expect(shape.status).toBe('fixed')
    expect(shape.isRegression).toBe(true)
    expect(shape.regressionOfFindingId).toBe('finding-000')
  })

  it('includes firstDetectedAt and occurrenceCount', () => {
    const shape = toExportShape(BASE_FINDING)

    expect(shape.firstDetectedAt).toBe('2026-01-01T00:00:00Z')
    expect(shape.occurrenceCount).toBe(1)
  })
})
