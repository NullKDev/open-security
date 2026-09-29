/**
 * tests/unit/pipeline/stage1-scoped.test.ts
 *
 * TDD: T-D05 — stage1 scopeFiles + skipScanners support
 * RED → GREEN → REFACTOR
 *
 * Verifies that runStage1Classical correctly restricts results to scopeFiles
 * when provided and skips OSV scanner when skipScanners includes 'osv'.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ScannerResult, NormalizedFinding } from '@/lib/scanners/types'
import { runStage1Classical } from '@/lib/pipeline/stage1-classical'

const SCAN_ID = 'scan-scope-test'
const TARGET_PATH = '/tmp/test-repo'

/** Build a mock scanner that returns findings for specific files */
function mockScanner(findings: NormalizedFinding[]): () => Promise<ScannerResult> {
  return async () => ({ status: 'completed', findings })
}

/** Skipped scanner (binary not found) */
function skippedScanner(): () => Promise<ScannerResult> {
  return async () => ({ status: 'skipped', reason: 'binary not found' })
}

describe('runStage1Classical — scopeFiles', () => {
  it('returns all findings when scopeFiles is not provided', async () => {
    const findings: NormalizedFinding[] = [
      {
        title: 'A',
        description: '',
        severity: 'high',
        locationPath: 'src/a.ts',
        locationLineStart: 1,
        detector: 'gitleaks',
      },
      {
        title: 'B',
        description: '',
        severity: 'medium',
        locationPath: 'src/b.ts',
        locationLineStart: 5,
        detector: 'semgrep',
      },
    ]

    const events: string[] = []
    const result = await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: (e) => events.push(e.type),
      scannerOverrides: {
        gitleaks: mockScanner([findings[0]]),
        trufflehog: mockScanner([]),
        semgrep: mockScanner([findings[1]]),
        osv: mockScanner([]),
      },
    })

    expect(result.findings).toHaveLength(2)
  })

  it('filters findings to scopeFiles when provided', async () => {
    const findingsAll: NormalizedFinding[] = [
      {
        title: 'InScope',
        description: '',
        severity: 'high',
        locationPath: 'src/auth/login.ts',
        locationLineStart: 1,
        detector: 'gitleaks',
      },
      {
        title: 'OutOfScope',
        description: '',
        severity: 'medium',
        locationPath: 'src/utils/helpers.ts',
        locationLineStart: 5,
        detector: 'semgrep',
      },
    ]

    const result = await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: () => {},
      scopeFiles: ['src/auth/login.ts'],
      scannerOverrides: {
        gitleaks: mockScanner(findingsAll),
        trufflehog: mockScanner([]),
        semgrep: mockScanner([findingsAll[1]]),
        osv: mockScanner([]),
      },
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe('InScope')
  })

  it('returns empty findings when scopeFiles excludes all results', async () => {
    const finding: NormalizedFinding = {
      title: 'NotInScope',
      description: '',
      severity: 'high',
      locationPath: 'src/other.ts',
      locationLineStart: 10,
      detector: 'semgrep',
    }

    const result = await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: () => {},
      scopeFiles: ['src/auth/login.ts'],
      scannerOverrides: {
        gitleaks: mockScanner([]),
        trufflehog: mockScanner([]),
        semgrep: mockScanner([finding]),
        osv: mockScanner([]),
      },
    })

    expect(result.findings).toHaveLength(0)
  })
})

describe('runStage1Classical — skipScanners', () => {
  it('skips osv scanner when skipScanners includes osv', async () => {
    const osvSpy = vi.fn().mockResolvedValue({ status: 'completed', findings: [] } satisfies ScannerResult)

    const result = await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: () => {},
      skipScanners: ['osv'],
      scannerOverrides: {
        gitleaks: mockScanner([]),
        trufflehog: mockScanner([]),
        semgrep: mockScanner([]),
        osv: osvSpy,
      },
    })

    expect(osvSpy).not.toHaveBeenCalled()
    expect(result.findings).toHaveLength(0)
  })

  it('does not skip osv when skipScanners is empty', async () => {
    const osvSpy = vi.fn().mockResolvedValue({ status: 'completed', findings: [] } satisfies ScannerResult)

    await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: () => {},
      skipScanners: [],
      scannerOverrides: {
        gitleaks: skippedScanner(),
        trufflehog: skippedScanner(),
        semgrep: skippedScanner(),
        osv: osvSpy,
      },
    })

    expect(osvSpy).toHaveBeenCalled()
  })

  it('can skip multiple scanners', async () => {
    const gitleaksSpy = vi.fn().mockResolvedValue({ status: 'completed', findings: [] } satisfies ScannerResult)
    const osvSpy = vi.fn().mockResolvedValue({ status: 'completed', findings: [] } satisfies ScannerResult)

    await runStage1Classical({
      scanId: SCAN_ID,
      targetPath: TARGET_PATH,
      onEvent: () => {},
      skipScanners: ['gitleaks', 'osv'],
      scannerOverrides: {
        gitleaks: gitleaksSpy,
        trufflehog: skippedScanner(),
        semgrep: skippedScanner(),
        osv: osvSpy,
      },
    })

    expect(gitleaksSpy).not.toHaveBeenCalled()
    expect(osvSpy).not.toHaveBeenCalled()
  })
})
