import { describe, it, expect } from 'vitest'
import { checkPrereqs } from '@/lib/config/prereqs'
import type { PrereqStatus } from '@/lib/config/prereqs'

function makeChecker(
  found: Record<string, string>,
): (name: string) => PrereqStatus {
  return (name: string): PrereqStatus => {
    if (name in found) {
      return { name, present: true, version: found[name] }
    }
    return { name, present: false }
  }
}

describe('checkPrereqs', () => {
  it('returns present=true with version for git when found', () => {
    const checker = makeChecker({ git: 'git version 2.39.0' })
    const results = checkPrereqs(checker)
    const git = results.find(r => r.name === 'git')
    expect(git).toBeDefined()
    expect(git!.present).toBe(true)
    expect(git!.version).toBe('git version 2.39.0')
  })

  it('returns present=false for gitleaks when not found', () => {
    const checker = makeChecker({ git: 'git version 2.39.0' })
    const results = checkPrereqs(checker)
    const gitleaks = results.find(r => r.name === 'gitleaks')
    expect(gitleaks).toBeDefined()
    expect(gitleaks!.present).toBe(false)
  })

  it('returns entries for all expected tools', () => {
    const checker = makeChecker({})
    const results = checkPrereqs(checker)
    const names = results.map(r => r.name)
    expect(names).toContain('git')
    expect(names).toContain('gitleaks')
    expect(names).toContain('semgrep')
    expect(names).toContain('trufflehog')
    expect(names).toContain('osv-scanner')
  })
})
