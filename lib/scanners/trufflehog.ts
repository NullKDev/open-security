import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { spawnProvider } from '@/lib/providers/cli/spawn'
import type {
  ScannerResult,
  NormalizedFinding,
  ScannerSpawnFn,
  ResolveCheckFn,
  Severity,
} from './types'

/** Shape of a single trufflehog NDJSON line */
interface TrufflehogRawFinding {
  DetectorName: string
  DecoderName?: string
  Verified: boolean
  Raw?: string
  SourceMetadata?: {
    Data?: {
      Filesystem?: {
        file?: string
        line?: number
      }
    }
  }
}

export interface TrufflehogOpts {
  resolveCheck?: ResolveCheckFn
  spawn?: ScannerSpawnFn
  cwd?: string
}

/**
 * Map trufflehog Verified flag to severity.
 * Verified secrets are high-confidence (high), unverified are medium.
 */
function mapSeverity(verified: boolean): Severity {
  return verified ? 'high' : 'medium'
}

/**
 * Normalize a trufflehog raw finding to the canonical format.
 */
function normalizeFinding(f: TrufflehogRawFinding): NormalizedFinding {
  const fs = f.SourceMetadata?.Data?.Filesystem

  return {
    title: f.DetectorName,
    description: f.Raw || `Secret detected by ${f.DetectorName}`,
    severity: mapSeverity(f.Verified),
    locationPath: fs?.file || '',
    locationLineStart: fs?.line ?? 0,
    locationLineEnd: undefined,
    detector: 'trufflehog',
  }
}

/**
 * Run trufflehog against a target directory.
 *
 * Uses `trufflehog filesystem <targetPath> --json`.
 * Output is newline-delimited JSON (NDJSON), one object per finding.
 */
export async function scanTrufflehog(
  targetPath: string,
  opts?: TrufflehogOpts,
): Promise<ScannerResult> {
  const check = opts?.resolveCheck ?? ((name: string) => resolveOnPath(name))

  if (!check('trufflehog')) {
    return { status: 'skipped', reason: 'binary not found' }
  }

  const spawn = opts?.spawn ?? (spawnProvider as unknown as ScannerSpawnFn)

  const result = spawn('trufflehog', ['filesystem', targetPath, '--json'], {
    cwd: opts?.cwd,
  })

  let stdout = ''
  for await (const chunk of result.stdout) {
    stdout += chunk
  }

  const exit = await result.exited

  if (exit.code !== 0) {
    let stderr = ''
    for await (const chunk of result.stderr) {
      stderr += chunk
    }
    return {
      status: 'error',
      reason: `trufflehog exited with code ${exit.code}${stderr ? ': ' + stderr.trim() : ''}`,
    }
  }

  // Parse NDJSON — each line is a JSON object
  const findings: NormalizedFinding[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const raw = JSON.parse(trimmed) as TrufflehogRawFinding
      if (raw.DetectorName) {
        findings.push(normalizeFinding(raw))
      }
    } catch {
      // Skip unparseable lines gracefully
    }
  }

  return { status: 'completed', findings }
}
