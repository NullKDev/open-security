/**
 * lib/policies/engine.ts
 *
 * Policy evaluation engine for v1.0.
 * Applies loaded PolicyRule[] to NormalizedFinding[] and returns EvaluatedFinding[].
 *
 * Rule application order matters — the first matching rule of each type wins.
 * Suppress/ignore rules are applied first; floor and assign are applied independently.
 */
import micromatch from 'micromatch'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { PolicyRule } from './rule-loader'

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A finding augmented with policy evaluation results.
 */
export interface EvaluatedFinding extends NormalizedFinding {
  /** Whether this finding is suppressed by a policy rule */
  policySuppressed: boolean
  /** ID of the policy rule that affected this finding (first matching rule) */
  policyRuleId?: string
  /** Assignee suggested by an `assign` rule */
  suggestedAssignee?: string
  /** Severity after applying a `severity_floor` rule (only set when the floor raises severity) */
  flooredSeverity?: string
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Evaluate a list of findings against the loaded policy rules.
 *
 * For each finding, rules are evaluated in order. The first rule that:
 * - Matches the finding's path (via micromatch glob)
 * - Is not expired (for `ignore` rules)
 * applies its decision:
 *   - `suppress` / `ignore`: marks `policySuppressed=true`
 *   - `severity_floor`: annotates `flooredSeverity` if below the floor level
 *   - `assign`: sets `suggestedAssignee`
 *
 * @param findings - Raw findings from the pipeline
 * @param rules - Loaded and merged policy rules
 * @returns Evaluated findings with policy metadata attached
 */
export function evaluateFindings(
  findings: NormalizedFinding[],
  rules: PolicyRule[],
): EvaluatedFinding[] {
  return findings.map((finding) => evaluate(finding, rules))
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function evaluate(finding: NormalizedFinding, rules: PolicyRule[]): EvaluatedFinding {
  let policySuppressed = false
  let policyRuleId: string | undefined
  let suggestedAssignee: string | undefined
  let flooredSeverity: string | undefined

  for (const rule of rules) {
    if (!ruleMatches(rule, finding)) continue
    if (isExpired(rule)) continue

    switch (rule.type) {
      case 'suppress':
      case 'ignore':
        if (!policySuppressed) {
          policySuppressed = true
          policyRuleId = rule.id
        }
        break

      case 'severity_floor': {
        const floorLevel = rule.decision.severity
        if (floorLevel && shouldApplyFloor(finding.severity, floorLevel)) {
          flooredSeverity = floorLevel
          if (!policyRuleId) {
            policyRuleId = rule.id
          }
        }
        break
      }

      case 'assign':
        if (!suggestedAssignee && rule.decision.assignee) {
          suggestedAssignee = rule.decision.assignee
          if (!policyRuleId) {
            policyRuleId = rule.id
          }
        }
        break
    }
  }

  const evaluated: EvaluatedFinding = {
    ...finding,
    policySuppressed,
  }

  if (policyRuleId !== undefined) evaluated.policyRuleId = policyRuleId
  if (suggestedAssignee !== undefined) evaluated.suggestedAssignee = suggestedAssignee
  if (flooredSeverity !== undefined) evaluated.flooredSeverity = flooredSeverity

  return evaluated
}

/**
 * Check if a rule matches the given finding based on match criteria.
 * An empty match object (`{}`) matches all findings.
 */
function ruleMatches(rule: PolicyRule, finding: NormalizedFinding): boolean {
  const { match } = rule

  // Path glob matching via micromatch
  if (match.path !== undefined) {
    if (!micromatch.isMatch(finding.locationPath, match.path)) {
      return false
    }
  }

  // Severity match (exact string)
  if (match.severity !== undefined && finding.severity !== match.severity) {
    return false
  }

  // Detector match (exact string)
  if (match.detector !== undefined && finding.detector !== match.detector) {
    return false
  }

  // Tag match: finding must include the tag
  if (match.tag !== undefined) {
    const tags = finding.tags ?? []
    if (!tags.includes(match.tag)) {
      return false
    }
  }

  return true
}

/**
 * Check if a rule has expired based on `decision.expiresAt`.
 */
function isExpired(rule: PolicyRule): boolean {
  const { expiresAt } = rule.decision
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

/**
 * Returns true if the floor level is ABOVE the current severity
 * (i.e., the floor would actually raise it).
 */
function shouldApplyFloor(currentSeverity: string, floorLevel: string): boolean {
  const current = SEVERITY_ORDER[currentSeverity] ?? -1
  const floor = SEVERITY_ORDER[floorLevel] ?? -1
  return floor > current
}
