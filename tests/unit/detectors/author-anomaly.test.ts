import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AuthorStatsEntry } from '@/lib/git/author-stats'

// ── Fixture authors ───────────────────────────────────────────
const normalAuthor: AuthorStatsEntry = {
  email: 'alice@example.com',
  name: 'Alice Engineer',
  commitCount: 15,
  firstSeen: '2024-01-01T00:00:00Z',
  lastSeen: '2024-06-01T00:00:00Z',
  totalInsertions: 500,
  totalDeletions: 100,
  anomalyFlags: {},
}

const singleCommitAuthor: AuthorStatsEntry = {
  email: 'newcomer@example.com',
  name: 'New Person',
  commitCount: 1,
  firstSeen: '2024-05-15T00:00:00Z',
  lastSeen: '2024-05-15T00:00:00Z',
  totalInsertions: 5,
  totalDeletions: 0,
  anomalyFlags: { singleCommit: true },
}

const domainOutlier: AuthorStatsEntry = {
  email: 'bob@personal-gmail.com',
  name: 'Bob Developer',
  commitCount: 8,
  firstSeen: '2024-02-01T00:00:00Z',
  lastSeen: '2024-05-01T00:00:00Z',
  totalInsertions: 300,
  totalDeletions: 50,
  anomalyFlags: {},
}

const nameMismatch: AuthorStatsEntry = {
  email: 'c@corp.com',
  name: 'Charlie X',
  commitCount: 5,
  firstSeen: '2024-03-01T00:00:00Z',
  lastSeen: '2024-04-01T00:00:00Z',
  totalInsertions: 100,
  totalDeletions: 20,
  anomalyFlags: {},
}

describe('author-anomaly detector', () => {
  // 1. SKILL.md validation
  describe('SKILL.md', () => {
    it('exists at detectors/repo/author-anomaly/SKILL.md', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/author-anomaly/SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('has valid YAML frontmatter with required fields', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/author-anomaly/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      expect(frontmatterMatch).toBeTruthy()

      const frontmatter = frontmatterMatch![1]
      expect(frontmatter).toContain('id:')
      expect(frontmatter).toContain('author-anomaly')
      expect(frontmatter).toContain('severity:')
      expect(frontmatter).toContain('description:')
    })

    it('contains a detection prompt template', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/author-anomaly/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')

      expect(content).toContain('Prompt')
      expect(content.length).toBeGreaterThan(150)
    })
  })

  // 2. Detection logic tests
  describe('detectAuthorAnomalies', () => {
    it('flags single-commit authors', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      const findings = detectAuthorAnomalies([singleCommitAuthor], 'scan-1')

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toContain('Single-commit author')
      expect(findings[0].description).toContain('newcomer@example.com')
    })

    it('flags authors whose email domain differs from the majority', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      // Most authors are @example.com, Bob is @personal-gmail.com
      const authors = [
        normalAuthor,
        { ...normalAuthor, email: 'dave@example.com' },
        { ...normalAuthor, email: 'eve@example.com' },
        domainOutlier, // @personal-gmail.com is outlier
      ]

      const findings = detectAuthorAnomalies(authors, 'scan-1')

      expect(findings.length).toBeGreaterThanOrEqual(1)
      const domainFinding = findings.find((f) => f.title.includes('domain'))
      expect(domainFinding).toBeDefined()
      expect(domainFinding!.description).toContain('personal-gmail.com')
    })

    it('flags authors whose name does not match the email pattern', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      // "Charlie X" with email "c@corp.com" — name doesn't suggest "Charlie"
      const findings = detectAuthorAnomalies([nameMismatch], 'scan-1')

      // Name/email mismatch detection — name doesn't appear in email
      expect(findings.length).toBeGreaterThanOrEqual(1)
      const mismatchFinding = findings.find((f) => f.title.includes('email mismatch'))
      expect(mismatchFinding).toBeDefined()
    })

    it('returns detector id from SKILL.md in findings', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      const findings = detectAuthorAnomalies([singleCommitAuthor], 'scan-1')
      expect(findings[0].detector).toBe('author-anomaly')
    })

    it('does not flag normal authors with no anomalies', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      const findings = detectAuthorAnomalies([normalAuthor], 'scan-1')
      expect(findings).toHaveLength(0)
    })

    it('handles empty author list', async () => {
      const { detectAuthorAnomalies } = await import('@/lib/git/detect')

      const findings = detectAuthorAnomalies([], 'scan-1')
      expect(findings).toHaveLength(0)
    })
  })
})
