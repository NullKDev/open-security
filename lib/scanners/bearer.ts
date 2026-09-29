import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { spawnProvider } from '@/lib/providers/cli/spawn'
import type {
  ScannerResult,
  NormalizedFinding,
  ScannerSpawnFn,
  ResolveCheckFn,
  Severity,
} from './types'

/** Shape of a single Bearer CLI JSON finding */
interface BearerRawFinding {
  id: string
  title: string
  description: string
  filename: string
  line_number: number
  severity: string
  fingerprint: string
}

/** Shape of the Bearer CLI JSON output */
interface BearerOutput {
  findings?: BearerRawFinding[]
}

export interface BearerOpts {
  resolveCheck?: ResolveCheckFn
  spawn?: ScannerSpawnFn
  cwd?: string
}

/**
 * Map Bearer severity labels to canonical Severity.
 * Bearer uses: critical, high, medium, low, warning
 */
function mapSeverity(bearerSeverity: string): Severity {
  switch (bearerSeverity.toLowerCase()) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    case 'low':
      return 'low'
    case 'warning':
      return 'low'
    default:
      return 'medium'
  }
}

/**
 * Normalize a Bearer raw finding to the canonical format.
 */
function normalizeFinding(f: BearerRawFinding): NormalizedFinding {
  return {
    title: f.title,
    description: f.description,
    severity: mapSeverity(f.severity),
    locationPath: f.filename,
    locationLineStart: f.line_number,
    detector: 'bearer',
  }
}

/**
 * Run Bearer CLI against a target directory.
 *
 * Uses `bearer scan --format json --quiet <targetPath>`.
 *
 * Bearer exit codes:
 * - 0: scan completed with no findings
 * - 1: scan completed with findings (NOT an error)
 * - 2+: unexpected error (scanner failed)
 *
 * Returns `{ status: 'skipped' }` if the binary is not found.
 */
export async function scanBearer(
  targetPath: string,
  opts?: BearerOpts,
): Promise<ScannerResult> {
  const check = opts?.resolveCheck ?? ((name: string) => resolveOnPath(name))

  if (!check('bearer')) {
    return { status: 'skipped', reason: 'binary not found' }
  }

  const spawn = opts?.spawn ?? (spawnProvider as unknown as ScannerSpawnFn)

  const result = spawn(
    'bearer',
    ['scan', '--format', 'json', '--quiet', targetPath],
    { cwd: opts?.cwd },
  )

  let stdout = ''
  for await (const chunk of result.stdout) {
    stdout += chunk
  }

  const exit = await result.exited

  // Exit code 0 = no findings, exit code 1 = findings found — both are successful runs
  if (exit.code !== 0 && exit.code !== 1) {
    let stderr = ''
    for await (const chunk of result.stderr) {
      stderr += chunk
    }
    return {
      status: 'error',
      reason: `bearer exited with code ${exit.code}${stderr ? ': ' + stderr.trim() : ''}`,
    }
  }

  // Exit code 0 with no output means no findings
  if (!stdout.trim()) {
    return { status: 'completed', findings: [] }
  }

  let parsed: BearerOutput
  try {
    parsed = JSON.parse(stdout) as BearerOutput
  } catch {
    return { status: 'error', reason: 'failed to parse bearer JSON output' }
  }

  const findings = parsed.findings ?? []
  return {
    status: 'completed',
    findings: findings.map(normalizeFinding),
  }
}
