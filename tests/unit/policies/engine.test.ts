/**
 * tests/unit/policies/engine.test.ts
 *
 * TDD RED → GREEN: T-010 + T-011 — policy engine
 *
 * Covers:
 * - suppress type: sets policy_suppressed status on matching finding
 * - ignore type: sets policy_suppressed; expired ignore → not suppressed
 * - severity_floor: annotates finding but keeps it (does not suppress)
 * - assign: sets suggested_assignee on matching finding
 * - No rules → pass-through (findings unchanged)
 * - Path glob matching via micromatch
 * - Non-matching rule → no effect
 */
import { describe, it, expect } from 'vitest'
import { evaluateFindings } from '@/lib/policies/engine'
import type { PolicyRule } from '@/lib/policies/rule-loader'
import type { NormalizedFinding } from '@/lib/scanners/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    title: 'Test Finding',
    description: 'A test finding',
    severity: 'high',
    locationPath: 'src/app/page.tsx',
    locationLineStart: 10,
    detector: 'semgrep',
    ...overrides,
  }
}

function makeRule(overrides: Partial<PolicyRule>): PolicyRule {
  return {
    id: 'rule-1',
    type: 'suppress',
    match: {},
    decision: { suppress: true },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('evaluateFindings', () => {
  describe('no rules', () => {
    it('returns findings unchanged when no rules are provided', () => {
      const findings = [makeFinding(), makeFinding({ locationPath: 'lib/utils.ts' })]
      const result = evaluateFindings(findings, [])
      expect(result).toHaveLength(2)
      expect(result.every((f) => f.policySuppressed === false)).toBe(true)
      expect(result.every((f) => f.policyRuleId === undefined)).toBe(true)
    })
  })

  describe('suppress rule', () => {
    it('suppress rule sets policySuppressed=true and policyRuleId on match', () => {
      const finding = makeFinding({ locationPath: 'src/tests/foo.test.ts' })
      const rule = makeRule({
        id: 'suppress-tests',
        type: 'suppress',
        match: { path: '**/*.test.ts' },
        decision: { suppress: true },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(true)
      expect(result.policyRuleId).toBe('suppress-tests')
    })

    it('suppress rule does not affect non-matching finding', () => {
      const finding = makeFinding({ locationPath: 'src/app/page.tsx' })
      const rule = makeRule({
        type: 'suppress',
        match: { path: '**/*.test.ts' },
        decision: { suppress: true },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(false)
    })
  })

  describe('ignore rule', () => {
    it('ignore rule without expiry sets policySuppressed=true', () => {
      const finding = makeFinding({ locationPath: 'src/app/page.tsx' })
      const rule = makeRule({
        id: 'ignore-all',
        type: 'ignore',
        match: { path: 'src/**' },
        decision: { suppress: true },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(true)
      expect(result.policyRuleId).toBe('ignore-all')
    })

    it('expired ignore rule does NOT suppress the finding', () => {
      const finding = makeFinding({ locationPath: 'src/app/page.tsx' })
      const rule = makeRule({
        id: 'expired-rule',
        type: 'ignore',
        match: { path: 'src/**' },
        decision: { suppress: true, expiresAt: '2020-01-01' },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(false)
      expect(result.policyRuleId).toBeUndefined()
    })

    it('future expiry date still suppresses', () => {
      const finding = makeFinding({ locationPath: 'src/app/page.tsx' })
      const futureDate = new Date(Date.now() + 86400 * 1000 * 365).toISOString().split('T')[0]
      const rule = makeRule({
        id: 'future-rule',
        type: 'ignore',
        match: { path: 'src/**' },
        decision: { suppress: true, expiresAt: futureDate },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(true)
    })
  })

  describe('severity_floor rule', () => {
    it('annotates finding with floored severity but does not suppress', () => {
      const finding = makeFinding({ severity: 'low' })
      const rule = makeRule({
        id: 'floor-rule',
        type: 'severity_floor',
        match: {},
        decision: { severity: 'medium' },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.policySuppressed).toBe(false)
      expect(result.policyRuleId).toBe('floor-rule')
      expect(result.flooredSeverity).toBe('medium')
    })

    it('does not floor when finding severity is already above the floor', () => {
      const finding = makeFinding({ severity: 'critical' })
      const rule = makeRule({
        type: 'severity_floor',
        match: {},
        decision: { severity: 'medium' },
      })
      const [result] = evaluateFindings([finding], [rule])
      // Floor only applies when finding is BELOW the floor
      expect(result.flooredSeverity).toBeUndefined()
    })
  })

  describe('assign rule', () => {
    it('sets suggestedAssignee on matching finding', () => {
      const finding = makeFinding({ locationPath: 'src/auth/middleware.ts' })
      const rule = makeRule({
        id: 'assign-alice',
        type: 'assign',
        match: { path: 'src/auth/**' },
        decision: { assignee: 'alice' },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.suggestedAssignee).toBe('alice')
      expect(result.policyRuleId).toBe('assign-alice')
      expect(result.policySuppressed).toBe(false)
    })

    it('does not set assignee when path does not match', () => {
      const finding = makeFinding({ locationPath: 'src/other/file.ts' })
      const rule = makeRule({
        type: 'assign',
        match: { path: 'src/auth/**' },
        decision: { assignee: 'alice' },
      })
      const [result] = evaluateFindings([finding], [rule])
      expect(result.suggestedAssignee).toBeUndefined()
    })
  })

  describe('multiple findings and rules', () => {
    it('processes multiple findings independently', () => {
      const findings = [
        makeFinding({ locationPath: 'src/tests/a.test.ts', detector: 'semgrep' }),
        makeFinding({ locationPath: 'src/app/page.tsx', detector: 'llm' }),
      ]
      const rule = makeRule({
        type: 'suppress',
        match: { path: '**/*.test.ts' },
        decision: { suppress: true },
      })
      const results = evaluateFindings(findings, [rule])
      expect(results[0].policySuppressed).toBe(true)
      expect(results[1].policySuppressed).toBe(false)
    })

    it('first matching rule wins (rules applied in order)', () => {
      const finding = makeFinding({ locationPath: 'src/app/page.tsx' })
      const rules: PolicyRule[] = [
        { id: 'rule-suppress', type: 'suppress', match: { path: 'src/**' }, decision: { suppress: true } },
        { id: 'rule-assign', type: 'assign', match: { path: 'src/**' }, decision: { assignee: 'bob' } },
      ]
      const [result] = evaluateFindings([finding], rules)
      // First rule (suppress) should be applied; second rule also matches but doesn't override
      expect(result.policySuppressed).toBe(true)
      expect(result.policyRuleId).toBe('rule-suppress')
    })
  })
})
