/**
 * pr-comment.ts — Fix & Prove PR comment composer
 *
 * Produces the Markdown comment posted to the operator's PR after a triad run.
 * Template defined in design.md §5 (REQ-FP-05).
 *
 * Two header variants:
 * - verified-fixed: ✅ Verified Fix — proof of repair
 * - fix-unverified: ⚠ Unverified Fix — proof of repair failed
 *
 * Content sections:
 * 1. Triad result table (unit test, regression pre, regression post)
 * 2. Fix diff (patch_diff in a fenced code block)
 * 3. Regression test diff (if available)
 * 4. Collapsible <details> blocks for pre-patch and post-patch output
 *
 * Design reference: design.md §5
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface PrCommentInput {
  outcome: 'verified-fixed' | 'fix-unverified' | string
  patchDiff: string | null
  regressionTestPath: string | null
  regressionTestDiff: string | null
  unitTestPassed: boolean | null | undefined
  vulRunPassedPre: boolean | null | undefined
  vulRunPassedPost: boolean | null | undefined
  prePatchOutput: string | null | undefined
  postPatchOutput: string | null | undefined
  unitTestOutput: string | null | undefined
  failureReason: string | null | undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function triIcon(passed: boolean | null | undefined): string {
  return passed === true ? '✅ pass' : passed === false ? '❌ fail' : '— not run'
}

function boolTick(condition: boolean | null | undefined, trueLabel: string, falseLabel: string): string {
  if (condition === true) return `✅ ${trueLabel}`
  if (condition === false) return `❌ ${falseLabel}`
  return '— not run'
}

function details(summary: string, body: string | null | undefined): string {
  if (!body) return ''
  return `<details>\n<summary>${summary}</summary>\n<pre>${body}</pre>\n</details>\n\n`
}

// ─── Composer ─────────────────────────────────────────────────────────────

/**
 * Composes the Markdown PR comment for a Fix & Prove triad result.
 *
 * Posted via the v0.2 PR comment poster to the finding's associated PR.
 * The caller is responsible for posting; this function only builds the string.
 *
 * @param proof - The proof row data (from fix_proofs table or FixProofDTO)
 * @returns Markdown string ready to post as a GitHub PR comment
 */
export function composePrComment(proof: PrCommentInput): string {
  const isVerified = proof.outcome === 'verified-fixed'

  const header = isVerified
    ? '## ✅ Verified Fix — proof of repair'
    : '## ⚠ Unverified Fix — proof of repair failed'

  const intro = isVerified
    ? 'This patch was validated by the **PatchEval triad** in open-security:'
    : `This patch could **not** be fully verified. Reason: \`${proof.failureReason ?? 'unknown'}\``

  // Triad result table — pre column uses inverted semantics (FAIL is what we want)
  const preLabel = boolTick(
    proof.vulRunPassedPre === false ? true : proof.vulRunPassedPre === true ? false : undefined,
    'confirmed (test fails pre-patch)',
    'test was already passing',
  )
  const postLabel = boolTick(proof.vulRunPassedPost, 'confirmed', 'vuln still triggers')

  const triTable = [
    '| Step | Result |',
    '|------|--------|',
    `| Unit test suite (post-patch) | ${triIcon(proof.unitTestPassed)} |`,
    `| Regression test FAILS pre-patch | ${preLabel} |`,
    `| Regression test PASSES post-patch | ${postLabel} |`,
  ].join('\n')

  // Fix diff section
  const fixDiff = proof.patchDiff
    ? `### Fix diff\n\`\`\`diff\n${proof.patchDiff}\n\`\`\`\n`
    : ''

  // Regression test diff section
  let regressionSection = ''
  if (proof.regressionTestDiff) {
    const pathLabel = proof.regressionTestPath ? `File: \`${proof.regressionTestPath}\`` : ''
    regressionSection = `### Regression test\n${pathLabel}\n\`\`\`diff\n${proof.regressionTestDiff}\n\`\`\`\n\n`
  } else if (proof.regressionTestPath) {
    regressionSection = `### Regression test\nFile: \`${proof.regressionTestPath}\`\n\n`
  }

  // Collapsible output blocks
  const preOutput = details('Pre-patch run output', proof.prePatchOutput)
  const postOutput = details('Post-patch run output', proof.postPatchOutput)

  return [
    header,
    '',
    intro,
    '',
    triTable,
    '',
    fixDiff,
    regressionSection,
    preOutput,
    postOutput,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // collapse extra blank lines
    .trimEnd()
}
