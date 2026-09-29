/**
 * lib/pipeline/stage4-filter.ts
 *
 * Stage 4 — False-Positive Filter + Policy Engine
 *
 * Pipeline:
 *   1. FP filter: drop validated findings matching fp-filter.yaml path globs
 *   2. Policy engine: evaluate remaining findings against v1.0 policy rules
 *      - Suppress/ignore rules → move to policySuppressed output
 *      - Severity floor / assign rules → annotate passing findings
 */
import type { ScanEvent } from './events'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ValidationResult } from './stage3-validate'
import { loadPolicy, type FpFilterPolicy } from '@/lib/policies/loader'
import { evaluateFindings, type EvaluatedFinding } from '@/lib/policies/engine'
import type { PolicyRule } from '@/lib/policies/rule-loader'
import { computeConsensus, type ScannersManifest, type ScoredFinding } from '@/lib/consensus/consensus-engine'

export interface Stage4Opts {
  scanId: string
  validated: ValidationResult[]
  onEvent: (event: ScanEvent) => void
  /** Override parsed FP rules for testing — bypasses policy file loading entirely. */
  _fpRules?: ParsedFpRule[]
  /** Override policy rules for testing — bypasses policy file loading. */
  _policyRules?: PolicyRule[]
  /**
   * Override scanner manifest for testing.
   * Maps file path → list of detector names that ran on that file (errored excluded).
   * When omitted, defaults to {} (all findings default to single-source).
   */
  _scannersManifest?: ScannersManifest
}

export interface Stage4Result {
  filtered: NormalizedFinding[]
  /** Findings suppressed by a policy rule (stored with status='policy_suppressed'). */
  policySuppressed: EvaluatedFinding[]
  droppedCount: number
}

/** Parsed FpFilterRule — glob converted to RegExp at load time. */
interface ParsedFpRule {
  /** Original rule id for logging */
  id: string
  /** Compiled regex from the `match_path` glob pattern */
  pathRegex: RegExp
}

/**
 * Stage 4 — False-Positive Filter + Policy Engine
 *
 * FP filter: loads rules from `policies/fp-filter.yaml`. Findings whose
 * `locationPath` matches any rule are dropped as known false positives.
 *
 * Policy engine: evaluates remaining findings against v1.0 policy rules.
 * Suppressed findings are returned in `policySuppressed` for persistence
 * with `status='policy_suppressed'` (auditable, hidden from default queue).
 *
 * Missing policy files: silently pass all findings through.
 */
export async function runStage4Filter(opts: Stage4Opts): Promise<Stage4Result> {
  const { scanId, validated, onEvent, _fpRules, _policyRules, _scannersManifest } = opts

  onEvent({
    type: 'stage',
    stage: 'filter',
    message: `[${scanId}] Applying false-positive filter`,
  })

  // Only process validated true positives
  const truePositives = validated.filter((v) => v.passes).map((v) => v.finding)

  // ─── Step 1: FP filter ──────────────────────────────────────────────────────
  const fpRules = _fpRules ?? (await loadParsedFpRules())

  const afterFpFilter: NormalizedFinding[] = []
  let droppedCount = 0

  for (const finding of truePositives) {
    const matchedFpRule = fpRules.find((r) => r.pathRegex.test(finding.locationPath))
    if (matchedFpRule) {
      droppedCount++
      onEvent({
        type: 'progress',
        message: `FP filter dropped: ${finding.title} (${finding.locationPath}) [rule: ${matchedFpRule.id}]`,
      })
    } else {
      afterFpFilter.push(finding)
    }
  }

  // ─── Step 2: Policy engine ──────────────────────────────────────────────────
  const policyRules = _policyRules ?? []
  const evaluated = evaluateFindings(afterFpFilter, policyRules)

  // ─── Step 3: Consensus scoring ──────────────────────────────────────────────
  const manifest = _scannersManifest ?? {}
  // computeConsensus works on NormalizedFinding + optional dedupKey
  const scoredAll = computeConsensus(
    evaluated as Array<NormalizedFinding & { dedupKey?: string }>,
    manifest,
  )

  // Re-merge policy evaluation results with consensus scores
  // (scored findings overlay consensus fields onto evaluated findings)
  const scoredMap = new Map<string, ScoredFinding>()
  for (const sf of scoredAll) {
    const key = `${sf.dedupKey}:${sf.detector}:${sf.locationPath}`
    scoredMap.set(key, sf)
  }

  const filtered: NormalizedFinding[] = []
  const policySuppressed: EvaluatedFinding[] = []

  for (const ev of evaluated) {
    const evWithDedup = ev as EvaluatedFinding & { dedupKey?: string }
    const key = `${evWithDedup.dedupKey ?? ''}:${ev.detector}:${ev.locationPath}`
    const scored = scoredMap.get(key)

    // Merge consensus fields onto the evaluated finding
    const merged = scored ? { ...ev, ...scored } : ev

    if (ev.policySuppressed) {
      policySuppressed.push(merged as EvaluatedFinding)
      onEvent({
        type: 'progress',
        message: `Policy suppressed: ${ev.title} (${ev.locationPath}) [rule: ${ev.policyRuleId ?? 'unknown'}]`,
      })
    } else {
      filtered.push(merged)
    }
  }

  onEvent({
    type: 'stage',
    stage: 'filter',
    message: `[${scanId}] Filter complete — ${filtered.length} kept, ${droppedCount} FP-dropped, ${policySuppressed.length} policy-suppressed`,
  })

  return { filtered, policySuppressed, droppedCount }
}

// ─── FP Rule Loading ───────────────────────────────────────────────────────────

async function loadParsedFpRules(): Promise<ParsedFpRule[]> {
  try {
    const policy: FpFilterPolicy = await loadPolicy('fp-filter') as FpFilterPolicy
    return policy.rules.map((r) => ({
      id: r.id,
      pathRegex: globToRegex(r.match_path),
    }))
  } catch {
    // Policy file missing or invalid — no filtering
    return []
  }
}

// ─── Glob-to-Regex ─────────────────────────────────────────────────────────────

/**
 * Convert a simple glob pattern (supporting `**`, `*`, and literal `.`)
 * to a RegExp for matching file paths.
 *
 *   `**`  → `.*`       (matches any depth including zero)
 *   `*`   → `[^/]*`    (matches within a single path segment)
 *   `.`   → escaped     (matches literal dot)
 */
export function globToRegex(glob: string): RegExp {
  let src = '^'
  let i = 0

  while (i < glob.length) {
    if (glob[i] === '*' && glob[i + 1] === '*') {
      // `**` — zero or more path segments
      src += '.*'
      i += 2
      // Skip trailing `/` after `**` (e.g. `**/`) — it's covered by `.*`
      if (glob[i] === '/') i++
      continue
    }

    if (glob[i] === '*') {
      // `*` — match within a single segment (no `/`)
      src += '[^/]*'
      i++
      continue
    }

    // Escape regex special characters
    if ('.[]{}()|+?^$\\'.includes(glob[i])) {
      src += '\\' + glob[i]
    } else {
      src += glob[i]
    }
    i++
  }

  return new RegExp(src + '$')
}
