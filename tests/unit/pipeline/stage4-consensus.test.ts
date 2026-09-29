/**
 * tests/unit/pipeline/stage4-consensus.test.ts
 *
 * TDD RED → GREEN: T-015 — consensus engine wired into stage4-filter
 *
 * Covers:
 * - 2 scanners with same dedup_key → consensus_score=1.0, status='agree' on output
 * - 1/2 scanners flag → consensus_score=0.5, status='conflicted' on output
 * - Scanner manifest flows through stage4 (injected via _scannersManifest)
 * - Findings get scanner_votes JSON attached
 */
import { describe, it, expect } from 'vitest'
import { runStage4Filter } from '@/lib/pipeline/stage4-filter'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ValidationResult } from '@/lib/pipeline/stage3-validate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValidated(overrides: Partial<NormalizedFinding> & { dedupKey?: string } = {}): ValidationResult {
  return {
    finding: {
      title: 'Test Finding',
      description: 'A test finding',
      severity: 'high',
      locationPath: 'src/app/page.tsx',
      locationLineStart: 10,
      detector: 'semgrep',
      ...overrides,
    } as NormalizedFinding & { dedupKey?: string },
    passes: true,
    rationale: 'confirmed',
    model: 'test',
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stage4-filter + consensus engine', () => {
  it('2/2 scanner agreement → filtered finding has consensusScore=1.0 and status=agree', async () => {
    const validated = [
      makeValidated({ detector: 'semgrep', dedupKey: 'key-agree', locationPath: 'src/db.ts' }),
      makeValidated({ detector: 'llm', dedupKey: 'key-agree', locationPath: 'src/db.ts' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-cons-1',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [],
      _scannersManifest: { 'src/db.ts': ['semgrep', 'llm'] },
    })

    expect(result.filtered).toHaveLength(2)
    const scored = result.filtered as Array<NormalizedFinding & { consensusScore?: number; consensusStatus?: string }>
    expect(scored.every((f) => f.consensusScore === 1.0)).toBe(true)
    expect(scored.every((f) => f.consensusStatus === 'agree')).toBe(true)
  })

  it('1/2 scanner agreement → filtered finding has consensusScore=0.5 and status=conflicted', async () => {
    const validated = [
      makeValidated({ detector: 'semgrep', dedupKey: 'key-conflict', locationPath: 'src/auth.ts' }),
      // llm ran on src/auth.ts but did NOT flag key-conflict
    ]

    const result = await runStage4Filter({
      scanId: 'scan-cons-2',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [],
      _scannersManifest: { 'src/auth.ts': ['semgrep', 'llm'] },
    })

    expect(result.filtered).toHaveLength(1)
    const scored = result.filtered as Array<NormalizedFinding & { consensusScore?: number; consensusStatus?: string }>
    expect(scored[0].consensusScore).toBe(0.5)
    expect(scored[0].consensusStatus).toBe('conflicted')
  })

  it('scanner_votes JSON is attached to each filtered finding', async () => {
    const validated = [
      makeValidated({ detector: 'semgrep', dedupKey: 'key-votes', locationPath: 'src/utils.ts' }),
      makeValidated({ detector: 'llm', dedupKey: 'key-votes', locationPath: 'src/utils.ts' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-cons-3',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [],
      _scannersManifest: { 'src/utils.ts': ['semgrep', 'llm'] },
    })

    const scored = result.filtered as Array<NormalizedFinding & { scannerVotes?: string }>
    expect(scored[0].scannerVotes).toBeDefined()

    const votes = JSON.parse(scored[0].scannerVotes ?? '[]') as Array<{ detector: string; vote: string }>
    expect(votes).toHaveLength(2)
    expect(votes.every((v) => v.vote === 'flagged')).toBe(true)
  })

  it('no manifest provided → all findings default to single-source', async () => {
    const validated = [
      makeValidated({ detector: 'semgrep', dedupKey: 'key-single', locationPath: 'src/file.ts' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-cons-4',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [],
    })

    const scored = result.filtered as Array<NormalizedFinding & { consensusScore?: number; consensusStatus?: string }>
    expect(scored[0].consensusScore).toBe(1.0)
    expect(scored[0].consensusStatus).toBe('single-source')
  })

  it('policy-suppressed findings are also scored before being separated', async () => {
    const validated = [
      makeValidated({ detector: 'semgrep', dedupKey: 'key-suppressed', locationPath: 'src/tests/foo.test.ts' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-cons-5',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [
        { id: 'suppress-tests', type: 'suppress', match: { path: '**/*.test.ts' }, decision: { suppress: true } },
      ],
      _scannersManifest: { 'src/tests/foo.test.ts': ['semgrep'] },
    })

    expect(result.filtered).toHaveLength(0)
    expect(result.policySuppressed).toHaveLength(1)
    // Even suppressed findings get consensus scored
    const suppressed = result.policySuppressed[0] as unknown as { consensusScore?: number }
    expect(suppressed.consensusScore).toBe(1.0)
  })
})
