import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommitInfo } from '@/lib/git/history-walker'

// ── Fixture commits ──────────────────────────────────────────
const baseCommit = (overrides: Partial<CommitInfo>): CommitInfo => {
  const { hash = 'x'.repeat(40), ...rest } = overrides
  return {
    hash,
    message: 'normal commit',
    author: 'Dev',
    authorEmail: 'dev@example.com',
    date: '2024-06-15T14:00:00+01:00',
    filesChanged: 3,
    insertions: 50,
    deletions: 10,
    ...rest,
  }
}

// ── Tests ─────────────────────────────────────────────────────

describe('suspicious-commit detector', () => {
  // 1. SKILL.md validation
  describe('SKILL.md', () => {
    it('exists at detectors/repo/suspicious-commit/SKILL.md', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/suspicious-commit/SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('has valid YAML frontmatter with required fields', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/suspicious-commit/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      expect(frontmatterMatch).toBeTruthy()

      const frontmatter = frontmatterMatch![1]
      expect(frontmatter).toContain('id:')
      expect(frontmatter).toContain('suspicious-commit')
      expect(frontmatter).toContain('severity:')
      expect(frontmatter).toContain('description:')
    })

    it('lists suspicious keywords to detect', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/suspicious-commit/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')
      // Should mention at least some of the keyword categories
      expect(content.toLowerCase()).toMatch(/fix.*typo|wip|debug|test|remove.*cred/i)
    })
  })

  // 2. Detection logic tests
  describe('detectSuspiciousCommits', () => {
    it('flags commits with "fix typo" message', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({ hash: 'a1'.repeat(20), message: 'fix typo in readme' })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toContain('Suspicious commit message')
      expect(findings[0].locationCommit).toBe('a1'.repeat(20))
    })

    it('flags commits with "WIP" message', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({ hash: 'b2'.repeat(20), message: 'WIP debugging' })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings).toHaveLength(1)
      expect(findings[0].locationCommit).toBe('b2'.repeat(20))
    })

    it('flags commits containing "debug" in message', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({ hash: 'c3'.repeat(20), message: 'add debug logging' })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings).toHaveLength(1)
    })

    it('flags commits containing "remove creds" pattern', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({ hash: 'd4'.repeat(20), message: 'remove creds from config' })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings).toHaveLength(1)
      expect(findings[0].description).toMatch(/cred/i)
    })

    it('flags commits with diff size > 10k insertions', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({
        hash: 'e5'.repeat(20),
        message: 'add data files',
        insertions: 12000,
        filesChanged: 5,
      })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings.length).toBeGreaterThanOrEqual(1)
      const diffFinding = findings.find((f) => f.title.includes('Large diff'))
      expect(diffFinding).toBeDefined()
    })

    it('flags commits with unusual timezone (UTC-12 to UTC+14 range check)', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({
        hash: 'f6'.repeat(20),
        message: 'normal message',
        date: '2024-06-15T14:00:00-13:00', // UTC-13 is outside typical range
      })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings.length).toBeGreaterThanOrEqual(1)
      const tzFinding = findings.find((f) => f.title.includes('Unusual timezone'))
      expect(tzFinding).toBeDefined()
    })

    it('does not flag normal commits', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({
        hash: 'g7'.repeat(20),
        message: 'feat: add user authentication',
        insertions: 200,
        filesChanged: 8,
      })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings).toHaveLength(0)
    })

    it('can produce multiple findings per commit (keyword + large diff)', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const commits = [baseCommit({
        hash: 'h8'.repeat(20),
        message: 'debug: fix typo',
        insertions: 15000,
        filesChanged: 20,
      })]
      const findings = detectSuspiciousCommits(commits)

      expect(findings.length).toBeGreaterThanOrEqual(2)
    })

    it('handles empty commit list', async () => {
      const { detectSuspiciousCommits } = await import('@/lib/git/detect')

      const findings = detectSuspiciousCommits([])
      expect(findings).toHaveLength(0)
    })
  })
})
