import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { spawnProvider } from '@/lib/providers/cli/spawn'
import type {
  ScannerResult,
  NormalizedFinding,
  ScannerSpawnFn,
  ResolveCheckFn,
  Severity,
} from './types'

/** Semgrep CLI JSON output shape */
interface SemgrepOutput {
  results?: SemgrepResult[]
  errors?: unknown[]
}

interface SemgrepResult {
  check_id: string
  path: string
  start: { line: number; col: number }
  end: { line: number; col: number }
  extra: {
    message: string
    severity: string
    metadata?: Record<string, unknown>
  }
}

export interface SemgrepOpts {
  resolveCheck?: ResolveCheckFn
  spawn?: ScannerSpawnFn
  cwd?: string
}

/** Map semgrep severity labels to canonical Severity */
function mapSeverity(semgrepSeverity: string): Severity {
  switch (semgrepSeverity.toUpperCase()) {
    case 'ERROR':
      return 'high'
    case 'WARNING':
      return 'medium'
    case 'INFO':
      return 'info'
    default:
      return 'low'
  }
}

/**
 * Normalize a semgrep result to the canonical finding format.
 */
function normalizeFinding(r: SemgrepResult): NormalizedFinding {
  return {
    title: r.check_id,
    description: r.extra.message,
    severity: mapSeverity(r.extra.severity),
    locationPath: r.path,
    locationLineStart: r.start.line,
    locationLineEnd: r.end.line,
    detector: 'semgrep',
  }
}

/**
 * Run semgrep against a target directory.
 *
 * Uses `semgrep scan --json --config p/default <targetPath>`.
 * The `p/default` ruleset provides broad security-focused rules.
 */
export async function scanSemgrep(
  targetPath: string,
  opts?: SemgrepOpts,
): Promise<ScannerResult> {
  const check = opts?.resolveCheck ?? ((name: string) => resolveOnPath(name))

  if (!check('semgrep')) {
    return { status: 'skipped', reason: 'binary not found' }
  }

  const spawn = opts?.spawn ?? (spawnProvider as unknown as ScannerSpawnFn)

  const result = spawn(
    'semgrep',
    ['scan', '--json', '--config', 'p/default', targetPath],
    { cwd: opts?.cwd },
  )

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
      reason: `semgrep exited with code ${exit.code}${stderr ? ': ' + stderr.trim() : ''}`,
    }
  }

  let parsed: SemgrepOutput
  try {
    parsed = JSON.parse(stdout) as SemgrepOutput
  } catch {
    return { status: 'error', reason: 'failed to parse semgrep JSON output' }
  }

  const results = parsed.results ?? []
  return {
    status: 'completed',
    findings: results.map(normalizeFinding),
  }
}
