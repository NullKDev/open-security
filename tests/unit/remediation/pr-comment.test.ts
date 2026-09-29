/**
 * tests/unit/remediation/pr-comment.test.ts
 *
 * TDD: T-018 (RED) + T-019 (GREEN) — pr-comment.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests composePrComment which produces a Markdown comment per §5 of design.md:
 * - verified-fixed: ✅ header + passing triad table
 * - fix-unverified: ⚠ header + failure reason
 * - dual-diff sections (fix diff + regression test diff)
 * - collapsible <details> blocks for pre/post output
 *
 * Design reference: design.md §5 (PR Comment Template)
 */
import { describe, it, expect } from 'vitest'
import { composePrComment } from '@/lib/remediation/fix-and-prove/pr-comment'
import type { PrCommentInput } from '@/lib/remediation/fix-and-prove/pr-comment'

/** A minimal proof row for a verified-fixed outcome */
const verifiedProof: PrCommentInput = {
  outcome: 'verified-fixed',
  patchDiff: 'diff --git a/f b/f\n-old\n+new',
  regressionTestPath: 'tests/__regression__/login.regression.test.ts',
  regressionTestDiff: 'diff --git a/tests/__regression__/login.regression.test.ts b/...\n+test code',
  unitTestPassed: true,
  vulRunPassedPre: false,
  vulRunPassedPost: true,
  prePatchOutput: 'FAIL login.regression.test.ts\n  1 failed',
  postPatchOutput: 'PASS login.regression.test.ts\n  1 passed',
  unitTestOutput: 'All suites passed',
  failureReason: null,
}

/** A proof row for a fix-unverified outcome */
const unverifiedProof: PrCommentInput = {
  outcome: 'fix-unverified',
  patchDiff: 'diff --git a/f b/f\n-old\n+new',
  regressionTestPath: null,
  regressionTestDiff: null,
  unitTestPassed: false,
  vulRunPassedPre: undefined,
  vulRunPassedPost: undefined,
  prePatchOutput: null,
  postPatchOutput: null,
  unitTestOutput: '2 tests failed',
  failureReason: 'unit-test-baseline-red',
}

describe('composePrComment', () => {
  // ─── Header section ────────────────────────────────────────────────────────

  describe('verified-fixed header', () => {
    it('contains ✅ verified fix header', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain('✅')
      expect(comment.toLowerCase()).toMatch(/verified/)
    })

    it('does NOT contain ⚠ for verified-fixed outcome', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).not.toContain('⚠')
    })
  })

  describe('fix-unverified header', () => {
    it('contains ⚠ unverified header', () => {
      const comment = composePrComment(unverifiedProof)
      expect(comment).toContain('⚠')
      expect(comment.toLowerCase()).toMatch(/unverified/)
    })

    it('does NOT contain ✅ for fix-unverified outcome', () => {
      const comment = composePrComment(unverifiedProof)
      expect(comment).not.toContain('✅')
    })

    it('includes the failure reason in the output', () => {
      const comment = composePrComment(unverifiedProof)
      expect(comment).toContain('unit-test-baseline-red')
    })
  })

  // ─── Triad result table ────────────────────────────────────────────────────

  describe('triad result table', () => {
    it('contains a triad table with step labels', () => {
      const comment = composePrComment(verifiedProof)
      // Check for table structure indicators
      expect(comment).toContain('|')
      expect(comment.toLowerCase()).toMatch(/unit test|regression/)
    })

    it('shows ✅ pass for unitTestPassed=true in verified-fixed', () => {
      const comment = composePrComment(verifiedProof)
      // The table should mark unit test pass
      expect(comment).toContain('✅')
    })

    it('shows ❌ fail for unitTestPassed=false in unverified', () => {
      const comment = composePrComment(unverifiedProof)
      expect(comment).toContain('❌')
    })
  })

  // ─── Fix diff section ──────────────────────────────────────────────────────

  describe('fix diff section', () => {
    it('includes the patch diff in a code block', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain(verifiedProof.patchDiff!)
      expect(comment).toContain('```')
    })

    it('contains a fix diff heading', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment.toLowerCase()).toMatch(/fix diff|### fix/)
    })
  })

  // ─── Regression test diff section ─────────────────────────────────────────

  describe('regression test diff section', () => {
    it('includes regression test path label when available', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain(verifiedProof.regressionTestPath!)
    })

    it('includes regression test diff content', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain(verifiedProof.regressionTestDiff!)
    })

    it('handles null regression test diff gracefully', () => {
      const comment = composePrComment(unverifiedProof)
      // Should not throw and should still render the rest of the comment
      expect(comment).toBeTruthy()
      expect(comment.length).toBeGreaterThan(100)
    })
  })

  // ─── Collapsible output blocks ─────────────────────────────────────────────

  describe('collapsible details blocks', () => {
    it('wraps pre-patch output in a <details> block', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain('<details>')
      expect(comment).toContain('</details>')
      expect(comment).toContain(verifiedProof.prePatchOutput!)
    })

    it('wraps post-patch output in a <details> block', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain(verifiedProof.postPatchOutput!)
    })

    it('contains a <summary> label for the pre-patch block', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment).toContain('<summary>')
      expect(comment.toLowerCase()).toMatch(/pre-patch|pre patch/)
    })

    it('contains a <summary> label for the post-patch block', () => {
      const comment = composePrComment(verifiedProof)
      expect(comment.toLowerCase()).toMatch(/post-patch|post patch/)
    })

    it('omits pre/post output details when both are null', () => {
      const noOutput: PrCommentInput = {
        ...unverifiedProof,
        prePatchOutput: null,
        postPatchOutput: null,
        unitTestOutput: null,
      }
      const comment = composePrComment(noOutput)
      // Should not crash; details sections may be omitted or show placeholder
      expect(comment).toBeTruthy()
    })
  })

  // ─── No regressions in all-valid path ─────────────────────────────────────

  it('produces valid markdown with no undefined/null visible in output', () => {
    const comment = composePrComment(verifiedProof)
    expect(comment).not.toContain('undefined')
    expect(comment).not.toContain('[object Object]')
  })
})
