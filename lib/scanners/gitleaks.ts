import { resolveOnPath } from '@/lib/providers/cli/resolve'
import { spawnProvider } from '@/lib/providers/cli/spawn'
import type {
  ScannerResult,
  NormalizedFinding,
  ScannerSpawnFn,
  ResolveCheckFn,
} from './types'

/** Shape of a single gitleaks JSON output element */
interface GitleaksRawFinding {
  Description?: string
  Secret?: string
  File: string
  StartLine: number
  EndLine?: number
  RuleID: string
  Match?: string
}

export interface GitleaksOpts {
  resolveCheck?: ResolveCheckFn
  spawn?: ScannerSpawnFn
  cwd?: string
}

/**
 * Normalize a gitleaks raw finding to the canonical format.
 * Gitleaks findings are always at least HIGH severity — they represent
 * actual secret leaks.
 */
function normalizeFinding(f: GitleaksRawFinding): NormalizedFinding {
  return {
    title: f.RuleID,
    description: f.Description || `Secret detected: ${f.RuleID}`,
    severity: 'high',
    locationPath: f.File,
    locationLineStart: f.StartLine,
    locationLineEnd: f.EndLine,
    detector: 'gitleaks',
  }
}

/**
 * Run gitleaks against a target directory.
 *
 * Uses `gitleaks detect --format json --no-git --source <targetPath>`.
 * Returns a ScannerResult with normalized findings on success,
 * or `{ status: "skipped" }` if the binary is not found.
 */
export async function scanGitleaks(
  targetPath: string,
  opts?: GitleaksOpts,
): Promise<ScannerResult> {
  const check = opts?.resolveCheck ?? ((name: string) => resolveOnPath(name))

  if (!check('gitleaks')) {
    return { status: 'skipped', reason: 'binary not found' }
  }

  const spawn = opts?.spawn ?? (spawnProvider as unknown as ScannerSpawnFn)

  const result = spawn('gitleaks', ['detect', '--format', 'json', '--no-git', '--source', targetPath], {
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
    return { status: 'error', reason: `gitleaks exited with code ${exit.code}${stderr ? ': ' + stderr.trim() : ''}` }
  }

  let rawFindings: GitleaksRawFinding[]
  try {
    rawFindings = JSON.parse(stdout) as GitleaksRawFinding[]
    if (!Array.isArray(rawFindings)) {
      rawFindings = []
    }
  } catch {
    return { status: 'error', reason: 'failed to parse gitleaks JSON output' }
  }

  return {
    status: 'completed',
    findings: rawFindings.map(normalizeFinding),
  }
}
