import type { ScanEvent } from './events'
import type { ScannerResult, NormalizedFinding, ResolveCheckFn } from '@/lib/scanners/types'
import type { ScannersManifest } from '@/lib/consensus/consensus-engine'

export type ScannerFn = (targetPath: string) => Promise<ScannerResult>

export interface ScannerOverrides {
  gitleaks?: ScannerFn
  trufflehog?: ScannerFn
  semgrep?: ScannerFn
  osv?: ScannerFn
}

/** Scanner names that can be selectively skipped (e.g. OSV in diff scans) */
export type SkippableScanner = 'gitleaks' | 'trufflehog' | 'semgrep' | 'osv'

export interface Stage1Opts {
  scanId: string
  targetPath: string
  onEvent: (event: ScanEvent) => void
  /** Override binary resolve check for testing */
  resolveCheck?: ResolveCheckFn
  /** Override individual scanners for testing */
  scannerOverrides?: ScannerOverrides
  /**
   * v0.2 — Diff Mode: restrict findings to files in this list.
   * When provided, findings whose locationPath is NOT in this set are excluded.
   * Does not affect which tools are invoked (scope filtering is post-run).
   */
  scopeFiles?: string[]
  /**
   * v0.2 — Diff Mode: list of scanner names to skip entirely.
   * Use ['osv'] to skip dependency scanning in diff scans (performance budget).
   */
  skipScanners?: SkippableScanner[]
}

export interface Stage1Result {
  findings: NormalizedFinding[]
  /**
   * Scanner manifest for consensus computation.
   * Maps file path → list of detector names that ran successfully (errored scanners excluded).
   * Used by Stage 4 consensus engine to determine single-source vs agree vs conflicted.
   */
  scannersManifest: ScannersManifest
}

/**
 * Stage 1 — Classical Scanners
 *
 * Runs gitleaks, trufflehog, semgrep, and osv-scanner in parallel via
 * Promise.allSettled. Missing binaries are silently skipped (status: 'skipped').
 * Scan errors are emitted as error events but do NOT fail the pipeline.
 *
 * Returns aggregated findings from all scanners that completed successfully.
 */
export async function runStage1Classical(opts: Stage1Opts): Promise<Stage1Result> {
  const { scanId, targetPath, onEvent, resolveCheck, scannerOverrides, scopeFiles, skipScanners } = opts

  onEvent({
    type: 'stage',
    stage: 'classical',
    message: `[${scanId}] Running classical scanners on ${targetPath}`,
  })

  const scopeSet = scopeFiles ? new Set(scopeFiles) : null
  const skipSet = skipScanners ? new Set(skipScanners) : null

  const scanners = buildScanners(targetPath, resolveCheck, scannerOverrides, skipSet)

  const results = await Promise.allSettled(scanners.map((s) => s.run()))

  const allFindings: NormalizedFinding[] = []
  // Track which scanners ran successfully (for consensus manifest)
  const successfulScanners: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const scannerName = scanners[i].name

    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      onEvent({ type: 'error', message: `Classical scanner failed: ${reason}` })
      continue
    }

    const scanResult = result.value
    if (scanResult.status === 'skipped') {
      // Silently skip — binary not found or explicitly skipped
      continue
    }
    if (scanResult.status === 'error') {
      onEvent({ type: 'error', message: `Scanner error: ${scanResult.reason}` })
      continue
    }
    if (scanResult.status === 'completed') {
      successfulScanners.push(scannerName)
      for (const finding of scanResult.findings) {
        // v0.2: filter findings to scopeFiles when diff mode is active
        if (scopeSet && !scopeSet.has(finding.locationPath)) {
          continue
        }
        allFindings.push(finding)
        onEvent({ type: 'finding', finding })
      }
    }
  }

  // Build scanner manifest: for each file path seen in findings,
  // record the list of successful scanner names
  const scannersManifest: ScannersManifest = {}
  for (const finding of allFindings) {
    if (!scannersManifest[finding.locationPath]) {
      scannersManifest[finding.locationPath] = [...successfulScanners]
    }
  }

  onEvent({
    type: 'stage',
    stage: 'classical',
    message: `[${scanId}] Classical scan complete — ${allFindings.length} findings`,
  })

  return { findings: allFindings, scannersManifest }
}

interface ScannerDef {
  name: string
  run: () => Promise<ScannerResult>
}

function buildScanners(
  targetPath: string,
  resolveCheck: ResolveCheckFn | undefined,
  overrides: ScannerOverrides | undefined,
  skipSet: Set<SkippableScanner> | null,
): ScannerDef[] {
  const skip = (name: SkippableScanner): ScannerDef => ({
    name,
    run: async () => ({ status: 'skipped', reason: `explicitly skipped via skipScanners` }),
  })

  return [
    skipSet?.has('gitleaks')
      ? skip('gitleaks')
      : {
          name: 'gitleaks',
          run: overrides?.gitleaks
            ? () => overrides.gitleaks!(targetPath)
            : () => import('@/lib/scanners/gitleaks').then(({ scanGitleaks }) =>
                scanGitleaks(targetPath, { resolveCheck }),
              ),
        },
    skipSet?.has('trufflehog')
      ? skip('trufflehog')
      : {
          name: 'trufflehog',
          run: overrides?.trufflehog
            ? () => overrides.trufflehog!(targetPath)
            : () => import('@/lib/scanners/trufflehog').then(({ scanTrufflehog }) =>
                scanTrufflehog(targetPath, { resolveCheck }),
              ),
        },
    skipSet?.has('semgrep')
      ? skip('semgrep')
      : {
          name: 'semgrep',
          run: overrides?.semgrep
            ? () => overrides.semgrep!(targetPath)
            : () => import('@/lib/scanners/semgrep').then(({ scanSemgrep }) =>
                scanSemgrep(targetPath, { resolveCheck }),
              ),
        },
    skipSet?.has('osv')
      ? skip('osv')
      : {
          name: 'osv',
          run: overrides?.osv
            ? () => overrides.osv!(targetPath)
            : () => import('@/lib/scanners/osv-scanner').then(({ scanOsvScanner }) =>
                scanOsvScanner(targetPath, { resolveCheck }),
              ),
        },
  ]
}
