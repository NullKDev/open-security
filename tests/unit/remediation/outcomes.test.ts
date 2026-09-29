/**
 * tests/unit/remediation/outcomes.test.ts
 *
 * TDD: T-016 (RED) + T-017 (GREEN) — outcomes.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the pure computeOutcome function which maps the three triad signals
 * and the patch-exists flag to one of five outcome states.
 *
 * All five spec scenarios are covered:
 * - Happy path:         unit✓, pre✗, post✓ → verified-fixed
 * - No patch:          patchExists=false   → fix-unverified/no-patch
 * - Baseline red:      unit=false          → fix-unverified/unit-test-baseline-red
 * - Test invalid:      pre=true            → fix-unverified/regression-test-invalid
 * - Vul not eliminated: post=false         → fix-unverified/vul-not-eliminated
 *
 * Design reference: spec.md §Scenarios, design.md §2.2
 */
import { describe, it, expect } from 'vitest'
import { computeOutcome } from '@/lib/remediation/fix-and-prove/outcomes'

describe('computeOutcome', () => {
  // ─── Happy path ───────────────────────────────────────────────────────────

  it('returns verified-fixed when all triad signals indicate success', () => {
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: true,
      vulRunPassedPre: false,
      vulRunPassedPost: true,
    })

    expect(result.outcome).toBe('verified-fixed')
    expect(result.failureReason).toBeUndefined()
  })

  // ─── No patch ─────────────────────────────────────────────────────────────

  it('returns fix-unverified/no-patch when patchExists is false', () => {
    const result = computeOutcome({
      patchExists: false,
      unitTestPassed: undefined,
      vulRunPassedPre: undefined,
      vulRunPassedPost: undefined,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('no-patch')
  })

  it('returns fix-unverified/no-patch regardless of signal values when no patch', () => {
    // Even if signals were somehow set, no-patch takes priority
    const result = computeOutcome({
      patchExists: false,
      unitTestPassed: true,
      vulRunPassedPre: false,
      vulRunPassedPost: true,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('no-patch')
  })

  // ─── Baseline red ─────────────────────────────────────────────────────────

  it('returns fix-unverified/unit-test-baseline-red when unit tests fail', () => {
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: false,
      vulRunPassedPre: undefined,
      vulRunPassedPost: undefined,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('unit-test-baseline-red')
  })

  it('baseline-red takes priority over other failures', () => {
    // Even if pre is also wrong, baseline-red is reported first
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: false,
      vulRunPassedPre: true,
      vulRunPassedPost: false,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('unit-test-baseline-red')
  })

  // ─── Regression test invalid (pre=true) ───────────────────────────────────

  it('returns fix-unverified/regression-test-invalid when pre-patch run passes', () => {
    // The regression test must FAIL before the patch — if it passes, it's invalid
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: true,
      vulRunPassedPre: true,
      vulRunPassedPost: true,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('regression-test-invalid')
  })

  it('regression-test-invalid even when post also passes', () => {
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: true,
      vulRunPassedPre: true,
      vulRunPassedPost: false,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('regression-test-invalid')
  })

  // ─── Vul not eliminated ────────────────────────────────────────────────────

  it('returns fix-unverified/vul-not-eliminated when post-patch run fails', () => {
    // Pre is correctly failing (test is valid) but post also fails (patch doesn't fix it)
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: true,
      vulRunPassedPre: false,
      vulRunPassedPost: false,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('vul-not-eliminated')
  })

  // ─── Edge: partial signals (undefined) ────────────────────────────────────

  it('returns fix-unverified/vul-not-eliminated when post is undefined (triad did not complete)', () => {
    // If the triad never got to post-patch, treat as not-eliminated
    const result = computeOutcome({
      patchExists: true,
      unitTestPassed: true,
      vulRunPassedPre: false,
      vulRunPassedPost: undefined,
    })

    expect(result.outcome).toBe('fix-unverified')
    expect(result.failureReason).toBe('vul-not-eliminated')
  })
})
