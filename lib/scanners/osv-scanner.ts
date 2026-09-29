import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { spawnProvider } from '@/lib/providers/cli/spawn'
import type {
  ScannerResult,
  NormalizedFinding,
  ScannerSpawnFn,
  ResolveCheckFn,
  Severity,
} from './types'

/** osv-scanner JSON output shape */
interface OsvOutput {
  results?: OsvResult[]
}

interface OsvResult {
  source?: { path: string; type: string }
  packages?: OsvPackage[]
}

interface OsvPackage {
  package: { name: string; version: string; ecosystem: string }
  vulnerabilities?: OsvVulnerability[]
}

interface OsvVulnerability {
  id: string
  summary?: string
  details?: string
  severity?: OsvSeverity[]
  aliases?: string[]
}

interface OsvSeverity {
  type: string
  score: string
}

export interface OsvScannerOpts {
  resolveCheck?: ResolveCheckFn
  spawn?: ScannerSpawnFn
  cwd?: string
}

/**
 * Map a CVSS v3 score string to canonical Severity.
 *
 * Ranges:
 * - 0.0               → info
 * - 0.1 – 3.9         → low
 * - 4.0 – 6.9         → medium
 * - 7.0 – 8.9         → high
 * - 9.0 – 10.0        → critical
 * - missing / invalid  → medium (default)
 */
function cvssToSeverity(scoreStr: string): Severity {
  const score = parseFloat(scoreStr)
  if (Number.isNaN(score)) return 'medium'
  if (score === 0) return 'info'
  if (score < 4.0) return 'low'
  if (score < 7.0) return 'medium'
  if (score < 9.0) return 'high'
  return 'critical'
}

/**
 * Extract the best CVSS v3 score from a vulnerability's severity list.
 * Falls back to returning null if no CVSS_V3 score is present.
 */
function extractCvssScore(vuln: OsvVulnerability): string | null {
  if (!vuln.severity || vuln.severity.length === 0) return null
  // Prefer CVSS_V3
  for (const s of vuln.severity) {
    if (s.type === 'CVSS_V3') return s.score
  }
  // Accept any severity type as fallback
  for (const s of vuln.severity) {
    return s.score
  }
  return null
}

/**
 * Normalize an osv-scanner vulnerability to the canonical finding format.
 */
function normalizeVulnerability(
  vuln: OsvVulnerability,
  pkg: OsvPackage,
): NormalizedFinding {
  const cvss = extractCvssScore(vuln)

  return {
    title: vuln.id,
    description: vuln.summary || vuln.details || `Vulnerability: ${vuln.id}`,
    severity: cvss ? cvssToSeverity(cvss) : 'medium',
    locationPath: `${pkg.package.name}@${pkg.package.version}`,
    locationLineStart: 0,
    locationLineEnd: undefined,
    detector: 'osv-scanner',
  }
}

/**
 * Run osv-scanner against a target directory.
 *
 * Uses `osv-scanner --format json -r <targetPath>`.
 * CVSS scores are mapped to canonical severity levels.
 */
export async function scanOsvScanner(
  targetPath: string,
  opts?: OsvScannerOpts,
): Promise<ScannerResult> {
  const check = opts?.resolveCheck ?? ((name: string) => resolveOnPath(name))

  if (!check('osv-scanner')) {
    return { status: 'skipped', reason: 'binary not found' }
  }

  const spawn = opts?.spawn ?? (spawnProvider as unknown as ScannerSpawnFn)

  const result = spawn('osv-scanner', ['--format', 'json', '-r', targetPath], {
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
      reason: `osv-scanner exited with code ${exit.code}${stderr ? ': ' + stderr.trim() : ''}`,
    }
  }

  let parsed: OsvOutput
  try {
    parsed = JSON.parse(stdout) as OsvOutput
  } catch {
    return { status: 'error', reason: 'failed to parse osv-scanner JSON output' }
  }

  const findings: NormalizedFinding[] = []
  for (const result of parsed.results ?? []) {
    for (const pkg of result.packages ?? []) {
      for (const vuln of pkg.vulnerabilities ?? []) {
        findings.push(normalizeVulnerability(vuln, pkg))
      }
    }
  }

  return { status: 'completed', findings }
}
