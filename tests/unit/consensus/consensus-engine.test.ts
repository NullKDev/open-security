/**
 * tests/unit/consensus/consensus-engine.test.ts
 *
 * TDD RED → GREEN: T-013 + T-014 — consensus-engine
 *
 * Covers:
 * - 2/2 scanners agree → score 1.0, status 'agree'
 * - 1/2 scanners agree → score 0.5, status 'conflicted'
 * - Single scanner ran → score 1.0, status 'single-source'
 * - Errored scanner is excluded from candidates (not counted)
 * - scanner_votes JSON contains per-scanner vote records
 */
import { describe, it, expect } from 'vitest'
import { computeConsensus } from '@/lib/consensus/consensus-engine'
import type { NormalizedFinding } from '@/lib/scanners/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<NormalizedFinding> & { dedupKey?: string } = {}): NormalizedFinding & { dedupKey: string } {
  return {
    title: 'Test Finding',
    description: 'A test finding',
    severity: 'high',
    locationPath: 'src/app/page.tsx',
    locationLineStart: 10,
    detector: 'semgrep',
    dedupKey: 'key-1',
    ...overrides,
  }
}

/** Scanner manifest: maps filePath → list of detector names that ran (and didn't error) */
type ScannersManifest = Record<string, string[]>

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeConsensus', () => {
  describe('full agreement (2/2)', () => {
    it('score = 1.0 and status = agree when both scanners flag the same dedup_key', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-1', locationPath: 'src/db.ts' }),
        makeFinding({ detector: 'llm', dedupKey: 'key-1', locationPath: 'src/db.ts' }),
      ]

      const manifest: ScannersManifest = {
        'src/db.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)

      // Both findings for key-1 get score 1.0
      expect(result).toHaveLength(2)
      const scores = result.map((f) => ({ score: f.consensusScore, status: f.consensusStatus }))
      expect(scores.every((s) => s.score === 1.0)).toBe(true)
      expect(scores.every((s) => s.status === 'agree')).toBe(true)
    })

    it('scanner_votes contains flagged for both detectors', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-1', locationPath: 'src/db.ts' }),
        makeFinding({ detector: 'llm', dedupKey: 'key-1', locationPath: 'src/db.ts' }),
      ]

      const manifest: ScannersManifest = {
        'src/db.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)
      const votes = JSON.parse(result[0].scannerVotes ?? '[]') as Array<{ detector: string; vote: string }>
      expect(votes).toHaveLength(2)
      expect(votes.every((v) => v.vote === 'flagged')).toBe(true)
    })
  })

  describe('partial agreement (1/2)', () => {
    it('score = 0.5 and status = conflicted when only one scanner flags', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-2', locationPath: 'src/auth.ts' }),
        // llm ran but did NOT flag key-2 for src/auth.ts
      ]

      const manifest: ScannersManifest = {
        'src/auth.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)

      expect(result).toHaveLength(1)
      expect(result[0].consensusScore).toBe(0.5)
      expect(result[0].consensusStatus).toBe('conflicted')
    })

    it('scanner_votes has flagged for semgrep and silent for llm', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-2', locationPath: 'src/auth.ts' }),
      ]

      const manifest: ScannersManifest = {
        'src/auth.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)
      const votes = JSON.parse(result[0].scannerVotes ?? '[]') as Array<{ detector: string; vote: string }>

      const semgrepVote = votes.find((v) => v.detector === 'semgrep')
      const llmVote = votes.find((v) => v.detector === 'llm')

      expect(semgrepVote?.vote).toBe('flagged')
      expect(llmVote?.vote).toBe('silent')
    })
  })

  describe('single-source', () => {
    it('score = 1.0 and status = single-source when only one scanner ran on the file', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-3', locationPath: 'src/only.ts' }),
      ]

      const manifest: ScannersManifest = {
        'src/only.ts': ['semgrep'],
      }

      const result = computeConsensus(findings, manifest)

      expect(result).toHaveLength(1)
      expect(result[0].consensusScore).toBe(1.0)
      expect(result[0].consensusStatus).toBe('single-source')
    })

    it('no manifest entry for file → single-source (defensive fallback)', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-4', locationPath: 'src/unknown.ts' }),
      ]

      const result = computeConsensus(findings, {})

      expect(result[0].consensusScore).toBe(1.0)
      expect(result[0].consensusStatus).toBe('single-source')
    })
  })

  describe('errored scanner exclusion', () => {
    it('errored scanner is excluded from candidates; 1/1 valid → agree', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-5', locationPath: 'src/core.ts' }),
      ]

      // osv-scanner errored — excluded from manifest
      // only semgrep is a valid candidate
      const manifest: ScannersManifest = {
        'src/core.ts': ['semgrep'],  // osv-scanner not listed (errored)
      }

      const result = computeConsensus(findings, manifest)

      // 1/1 valid candidates agree → score 1.0, agree
      expect(result[0].consensusScore).toBe(1.0)
      expect(result[0].consensusStatus).toBe('single-source')
    })

    it('2 valid scanners, 1 errored — errored not counted in denominator', () => {
      // 2 valid candidates ran; both agree on key-6
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-6', locationPath: 'src/core.ts' }),
        makeFinding({ detector: 'llm', dedupKey: 'key-6', locationPath: 'src/core.ts' }),
      ]

      // osv-scanner errored — not in manifest
      const manifest: ScannersManifest = {
        'src/core.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)
      expect(result[0].consensusScore).toBe(1.0)
      expect(result[0].consensusStatus).toBe('agree')
    })
  })

  describe('multiple dedup keys', () => {
    it('computes consensus independently per dedup_key', () => {
      const findings = [
        makeFinding({ detector: 'semgrep', dedupKey: 'key-a', locationPath: 'src/a.ts' }),
        makeFinding({ detector: 'llm', dedupKey: 'key-a', locationPath: 'src/a.ts' }),
        makeFinding({ detector: 'semgrep', dedupKey: 'key-b', locationPath: 'src/b.ts' }),
        // llm did NOT flag key-b
      ]

      const manifest: ScannersManifest = {
        'src/a.ts': ['semgrep', 'llm'],
        'src/b.ts': ['semgrep', 'llm'],
      }

      const result = computeConsensus(findings, manifest)

      const keyA = result.filter((f) => (f as NormalizedFinding & { dedupKey: string }).dedupKey === 'key-a')
      const keyB = result.filter((f) => (f as NormalizedFinding & { dedupKey: string }).dedupKey === 'key-b')

      expect(keyA.every((f) => f.consensusStatus === 'agree')).toBe(true)
      expect(keyB.every((f) => f.consensusStatus === 'conflicted')).toBe(true)
      expect(keyB[0].consensusScore).toBe(0.5)
    })
  })

  describe('empty inputs', () => {
    it('returns empty array when no findings', () => {
      const result = computeConsensus([], {})
      expect(result).toEqual([])
    })
  })
})
