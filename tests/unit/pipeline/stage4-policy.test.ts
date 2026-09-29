/**
 * tests/unit/pipeline/stage4-policy.test.ts
 *
 * TDD RED → GREEN: T-012 — policy engine wired into stage4-filter
 *
 * Covers:
 * - Findings matching a suppress rule are persisted with status='policy_suppressed'
 * - Suppressed findings are removed from the filtered output (not passed to next stage)
 * - policy_rule_id is attached on suppressed findings
 * - Non-matching findings pass through unchanged
 * - No policy rules → all findings pass through
 */
import { describe, it, expect } from 'vitest'
import { runStage4Filter } from '@/lib/pipeline/stage4-filter'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { PolicyRule } from '@/lib/policies/rule-loader'
import type { ValidationResult } from '@/lib/pipeline/stage3-validate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValidated(overrides: Partial<NormalizedFinding> = {}): ValidationResult {
  return {
    finding: {
      title: 'Test Finding',
      description: 'A test finding',
      severity: 'high',
      locationPath: 'src/app/page.tsx',
      locationLineStart: 10,
      detector: 'semgrep',
      ...overrides,
    },
    passes: true,
    rationale: 'confirmed',
    model: 'test',
  }
}

function makeSuppressRule(pathGlob: string, id = 'rule-suppress'): PolicyRule {
  return {
    id,
    type: 'suppress',
    match: { path: pathGlob },
    decision: { suppress: true },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stage4-filter + policy engine', () => {
  it('suppressed findings are excluded from filtered output', async () => {
    const validated = [
      makeValidated({ locationPath: 'src/tests/foo.test.ts', title: 'Test Vuln' }),
      makeValidated({ locationPath: 'src/app/page.tsx', title: 'Real Vuln' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-policy-1',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [makeSuppressRule('**/*.test.ts')],
    })

    // Only the non-suppressed finding passes through
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].title).toBe('Real Vuln')
  })

  it('suppressed findings appear in policySuppressed output with policyRuleId', async () => {
    const validated = [
      makeValidated({ locationPath: 'src/tests/foo.test.ts', title: 'Test Vuln' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-policy-2',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [makeSuppressRule('**/*.test.ts', 'my-suppress-rule')],
    })

    expect(result.filtered).toHaveLength(0)
    expect(result.policySuppressed).toHaveLength(1)
    expect(result.policySuppressed[0].policyRuleId).toBe('my-suppress-rule')
    expect(result.policySuppressed[0].policySuppressed).toBe(true)
  })

  it('no policy rules → all findings pass through', async () => {
    const validated = [
      makeValidated({ locationPath: 'src/app/page.tsx' }),
      makeValidated({ locationPath: 'lib/utils.ts' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-policy-3',
      validated,
      onEvent: () => {},
      _fpRules: [],
      _policyRules: [],
    })

    expect(result.filtered).toHaveLength(2)
    expect(result.policySuppressed).toHaveLength(0)
  })

  it('FP filter drop and policy suppress are independent', async () => {
    const { globToRegex } = await import('@/lib/pipeline/stage4-filter')

    const validated = [
      makeValidated({ locationPath: 'src/tests/foo.test.ts', title: 'FP Test Vuln' }),
      makeValidated({ locationPath: 'src/fixtures/data.json', title: 'FP Fixture' }),
      makeValidated({ locationPath: 'src/app/page.tsx', title: 'Policy Suppressed' }),
      makeValidated({ locationPath: 'lib/utils.ts', title: 'Real Vuln' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-policy-4',
      validated,
      onEvent: () => {},
      _fpRules: [
        { id: 'fp-tests', pathRegex: globToRegex('**/*.test.ts') },
        { id: 'fp-fixtures', pathRegex: globToRegex('**/fixtures/**') },
      ],
      _policyRules: [
        makeSuppressRule('src/app/**'),
      ],
    })

    // 2 FP-dropped, 1 policy-suppressed, 1 passing through
    expect(result.filtered).toHaveLength(1)
    expect(result.filtered[0].title).toBe('Real Vuln')
    expect(result.policySuppressed).toHaveLength(1)
    expect(result.policySuppressed[0].title).toBe('Policy Suppressed')
    expect(result.droppedCount).toBe(2)
  })

  it('droppedCount only counts FP-filtered (not policy-suppressed)', async () => {
    const { globToRegex } = await import('@/lib/pipeline/stage4-filter')

    const validated = [
      makeValidated({ locationPath: 'src/tests/foo.test.ts' }),
      makeValidated({ locationPath: 'src/app/page.tsx' }),
    ]

    const result = await runStage4Filter({
      scanId: 'scan-policy-5',
      validated,
      onEvent: () => {},
      _fpRules: [{ id: 'fp-tests', pathRegex: globToRegex('**/*.test.ts') }],
      _policyRules: [makeSuppressRule('src/app/**')],
    })

    expect(result.droppedCount).toBe(1)  // Only FP drops
    expect(result.policySuppressed).toHaveLength(1)  // Policy separate
    expect(result.filtered).toHaveLength(0)
  })
})
