import { execFileSync } from 'node:child_process'

export interface PrereqStatus {
  name: string
  present: boolean
  version?: string
}

const PREREQS = ['git', 'gitleaks', 'semgrep', 'trufflehog', 'osv-scanner'] as const
export type PrereqName = (typeof PREREQS)[number]

export function checkBinary(name: string): PrereqStatus {
  try {
    const out = execFileSync(name, ['--version'], { encoding: 'utf8', timeout: 3000 })
    const version = out.trim().split('\n')[0]
    return { name, present: true, version }
  } catch {
    return { name, present: false }
  }
}

export function checkPrereqs(
  checker: (name: string) => PrereqStatus = checkBinary,
): PrereqStatus[] {
  return PREREQS.map(checker)
}
