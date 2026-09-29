import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CommitInfo } from '@/lib/git/history-walker'
import type { GitleaksRunFn, GitleaksRunResult } from '@/lib/git/detect'

// ── Fixture commits for testing ──────────────────────────────
const cleanCommit: CommitInfo = {
  hash: 'a'.repeat(40),
  message: 'docs: add readme',
  author: 'Alice',
  authorEmail: 'alice@example.com',
  date: '2024-01-01T10:00:00Z',
  filesChanged: 1,
  insertions: 5,
  deletions: 0,
}

const leakyCommit: CommitInfo = {
  hash: 'b'.repeat(40),
  message: 'feat: add config',
  author: 'Alice',
  authorEmail: 'alice@example.com',
  date: '2024-01-02T10:00:00Z',
  filesChanged: 1,
  insertions: 3,
  deletions: 0,
}

// ── Tests ─────────────────────────────────────────────────────

describe('secret-in-history detector', () => {
  // 1. SKILL.md validation
  describe('SKILL.md', () => {
    it('exists at detectors/repo/secret-in-history/SKILL.md', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/secret-in-history/SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
    })

    it('has valid YAML frontmatter with required fields', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/secret-in-history/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      expect(frontmatterMatch).toBeTruthy()

      // Parse via js-yaml dynamic import
      const frontmatter = frontmatterMatch![1]

      expect(frontmatter).toContain('id:')
      expect(frontmatter).toContain('secret-in-history')
      expect(frontmatter).toContain('severity:')
      expect(frontmatter).toContain('description:')
    })

    it('contains a detection prompt template', () => {
      const skillPath = resolve(process.cwd(), 'detectors/repo/secret-in-history/SKILL.md')
      const content = readFileSync(skillPath, 'utf-8')

      expect(content).toContain('Prompt')
      expect(content.length).toBeGreaterThan(200) // Must be substantive
    })
  })

  // 2. Detection logic tests (RED — module doesn't exist yet)
  describe('detectSecretsInHistory', () => {
    const noSecretsResult: GitleaksRunResult = { status: 'completed', findings: [] }
    const errorResult: GitleaksRunResult = { status: 'error', reason: 'permission denied' }
    const oneSecretResult: GitleaksRunResult = {
      status: 'completed',
      findings: [{
        title: 'aws-access-key',
        description: 'AWS Access Key found',
        severity: 'high',
        locationPath: 'config/secrets.env',
        locationLineStart: 4,
        detector: 'gitleaks',
      }],
    }
    const apiKeyResult: GitleaksRunResult = {
      status: 'completed',
      findings: [{
        title: 'generic-api-key',
        description: 'Found API key',
        severity: 'high',
        locationPath: 'src/api.ts',
        locationLineStart: 10,
        detector: 'gitleaks',
      }],
    }

    it('returns empty array for commits with no secrets', async () => {
      const { detectSecretsInHistory } = await import('@/lib/git/detect')

      const findings = await detectSecretsInHistory('/fake/repo', [cleanCommit], {
        runGitleaks: vi.fn<GitleaksRunFn>(() => noSecretsResult),
      })

      expect(findings).toHaveLength(0)
    })

    it('returns findings when gitleaks detects secrets in a commit', async () => {
      const { detectSecretsInHistory } = await import('@/lib/git/detect')

      const mockGitleaks = vi.fn<GitleaksRunFn>(() => oneSecretResult)

      const findings = await detectSecretsInHistory('/fake/repo', [leakyCommit], {
        runGitleaks: mockGitleaks,
      })

      expect(findings).toHaveLength(1)
      expect(findings[0].title).toBe('aws-access-key')
      expect(findings[0].severity).toBe('high')
      expect(findings[0].locationCommit).toBe(leakyCommit.hash)
    })

    it('includes detector metadata from SKILL.md in findings', async () => {
      const { detectSecretsInHistory } = await import('@/lib/git/detect')

      const mockGitleaks = vi.fn<GitleaksRunFn>(() => apiKeyResult)

      const findings = await detectSecretsInHistory('/fake/repo', [leakyCommit], {
        runGitleaks: mockGitleaks,
      })

      expect(findings[0].detector).toBe('secret-in-history')
    })

    it('handles gitleaks errors gracefully (skips failed blob)', async () => {
      const { detectSecretsInHistory } = await import('@/lib/git/detect')

      const mockGitleaks = vi.fn<GitleaksRunFn>(() => errorResult)

      const findings = await detectSecretsInHistory('/fake/repo', [leakyCommit], {
        runGitleaks: mockGitleaks,
      })

      // Should still return empty, not crash
      expect(findings).toHaveLength(0)
    })

    it('skips commits without file changes', async () => {
      const { detectSecretsInHistory } = await import('@/lib/git/detect')

      const emptyCommit: CommitInfo = {
        ...cleanCommit,
        hash: 'e'.repeat(40),
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      }

      const mockGitleaks = vi.fn<GitleaksRunFn>()

      const findings = await detectSecretsInHistory('/fake/repo', [emptyCommit], {
        runGitleaks: mockGitleaks,
      })

      // Skips — never calls gitleaks on empty commits
      expect(mockGitleaks).not.toHaveBeenCalled()
      expect(findings).toHaveLength(0)
    })
  })
})
