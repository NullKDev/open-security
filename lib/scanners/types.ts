/** Severity level for normalized findings */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** Canonical normalized finding across all scanners */
export interface NormalizedFinding {
  title: string
  description: string
  severity: Severity
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number
  detector: string
  tags?: string[]
}

/** Result from a scanner run */
export type ScannerResult =
  | { status: 'completed'; findings: NormalizedFinding[] }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; reason: string }

/** Injectable spawn result shape — subset of SpawnResult */
export interface ScannerSpawnResult {
  stdout: AsyncIterable<string>
  stderr: AsyncIterable<string>
  exited: Promise<{ code: number | null; signal: string | null }>
}

/** Injectable spawn function signature */
export type ScannerSpawnFn = (
  bin: string,
  argv: string[],
  opts?: { cwd?: string },
) => ScannerSpawnResult

/** Injectable binary-checker function signature */
export type ResolveCheckFn = (name: string) => boolean
