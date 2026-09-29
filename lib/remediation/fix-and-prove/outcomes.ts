/**
 * outcomes.ts — Triad outcome state machine
 *
 * Pure function that maps the four triad signals to one of two outcomes:
 * - 'verified-fixed'  — all signals correct; fix is cryptographically proven
 * - 'fix-unverified'  — one or more signals wrong; includes failure reason
 *
 * Failure reasons (per spec.md §Scenarios):
 * - 'no-patch'                — patchExists=false; triad did not run (REQ-FP-07)
 * - 'unit-test-baseline-red'  — unit tests fail before fix; baseline unreliable
 * - 'regression-test-invalid' — regression test passes pre-patch (always passes → invalid)
 * - 'vul-not-eliminated'      — regression test fails post-patch (patch doesn't fix the bug)
 *
 * Priority order for failure reasons matches the triad execution sequence.
 *
 * Design reference: spec.md REQ-FP-04, design.md §2.2
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface TriadSignals {
  /** True if the finding has a non-null patch_diff. Required to run the triad. */
  patchExists: boolean
  /** True if the project's test suite passed after applying the patch. */
  unitTestPassed: boolean | undefined
  /** True if the regression test PASSED before the patch (bad — test is invalid). */
  vulRunPassedPre: boolean | undefined
  /** True if the regression test PASSED after the patch (good — fix works). */
  vulRunPassedPost: boolean | undefined
}

export interface OutcomeResult {
  outcome: 'verified-fixed' | 'fix-unverified'
  failureReason?: string
}

// ─── State machine ────────────────────────────────────────────────────────

/**
 * Computes the Fix & Prove triad outcome from the four input signals.
 *
 * Evaluation order mirrors the triad execution sequence so the most
 * proximate failure reason is reported:
 *
 * 1. No patch → no-patch
 * 2. Unit baseline fails → unit-test-baseline-red
 * 3. Regression test already passes pre-patch → regression-test-invalid
 * 4. Regression test fails post-patch → vul-not-eliminated
 * 5. All signals correct → verified-fixed
 *
 * @param signals - The four triad boolean signals
 * @returns OutcomeResult with outcome and optional failureReason
 */
export function computeOutcome(signals: TriadSignals): OutcomeResult {
  const { patchExists, unitTestPassed, vulRunPassedPre, vulRunPassedPost } = signals

  // Guard 1: no patch — triad cannot run (REQ-FP-07)
  if (!patchExists) {
    return { outcome: 'fix-unverified', failureReason: 'no-patch' }
  }

  // Guard 2: unit test baseline is red — cannot trust any further signals
  if (unitTestPassed === false) {
    return { outcome: 'fix-unverified', failureReason: 'unit-test-baseline-red' }
  }

  // Guard 3: regression test passes pre-patch — test is not valid (already-passing)
  if (vulRunPassedPre === true) {
    return { outcome: 'fix-unverified', failureReason: 'regression-test-invalid' }
  }

  // Guard 4: regression test fails post-patch — vulnerability is not eliminated
  if (vulRunPassedPost !== true) {
    return { outcome: 'fix-unverified', failureReason: 'vul-not-eliminated' }
  }

  // All signals correct: unit=true, pre=false, post=true
  return { outcome: 'verified-fixed' }
}
