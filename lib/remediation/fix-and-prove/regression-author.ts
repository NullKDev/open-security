/**
 * regression-author.ts — ACP Turn-3 prompt construction and test path heuristics
 *
 * Provides two functions:
 * - buildTurn3Prompt: constructs the inline ACP Turn-3 prompt that instructs
 *   the agent to author a regression test for the specific vulnerability
 * - resolveTestPath: determines where the regression test should be written,
 *   using a priority heuristic over standard test directories
 *
 * Design reference: design.md §6 (Q1 resolution), §2.2 (Turn 3), ADR-1
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── Test directory heuristic ──────────────────────────────────────────────

/** Ordered list of standard test directory names to probe (highest priority first). */
const TEST_DIR_CANDIDATES = ['tests', '__tests__', 'test'] as const

/**
 * Resolves the path where the regression test should be written.
 *
 * Heuristic (priority order, per design.md §6 Q1 resolution):
 * 1. If `tests/` exists at `projectDir` root → write there
 * 2. If `__tests__/` exists at `projectDir` root → write there
 * 3. If `test/` exists at `projectDir` root → write there
 * 4. Fallback: create `<vulnFileDir>/__regression__/<basename>.regression.test.ts`
 *
 * The agent receives this path as a hint in the Turn-3 prompt and is required
 * to confirm the final path in its response.
 *
 * @param projectDir - Root directory of the project being analysed
 * @param vulnFilePath - Relative path to the vulnerable file (e.g. "src/auth/login.ts")
 * @returns Absolute path where the regression test should be written
 */
export function resolveTestPath(projectDir: string, vulnFilePath: string): string {
  const basename = path.basename(vulnFilePath, path.extname(vulnFilePath))
  const testFileName = `${basename}.regression.test.ts`

  // Check standard test directories in priority order
  for (const candidate of TEST_DIR_CANDIDATES) {
    const candidatePath = path.join(projectDir, candidate)
    if (fs.existsSync(candidatePath)) {
      return path.join(candidatePath, testFileName)
    }
  }

  // Fallback: __regression__/ sibling of the vulnerable file's directory
  const vulnFileDir = path.dirname(vulnFilePath)
  return path.join(projectDir, vulnFileDir, '__regression__', testFileName)
}

// ─── Prompt construction ───────────────────────────────────────────────────

/**
 * Builds the ACP Turn-3 prompt that instructs the agent to author a regression
 * test targeting the specific vulnerability.
 *
 * The prompt includes:
 * - Vulnerability description (context for what to test)
 * - The applied patch diff (shows what was fixed)
 * - The vulnerable file path (for import/require guidance)
 * - An optional suggested test file path (from resolveTestPath)
 *
 * The agent is required to write the file and report its path back.
 *
 * @param description - Human-readable vulnerability description from the finding
 * @param patchDiff - Unified diff of the patch that was applied
 * @param vulnFilePath - Path to the file containing the vulnerability
 * @param suggestedTestPath - Optional path hint from resolveTestPath
 * @returns The prompt string to send as ACP Turn 3
 */
export function buildTurn3Prompt(
  description: string,
  patchDiff: string,
  vulnFilePath: string,
  suggestedTestPath?: string,
): string {
  const testPathSection = suggestedTestPath
    ? `Write the test to: \`${suggestedTestPath}\`\n\n`
    : 'Choose an appropriate test file path in the project test directory.\n\n'

  return `You are authoring a regression test that proves the following vulnerability is fixed.

## Vulnerability

${description}

## Vulnerable file

\`${vulnFilePath}\`

## Patch applied (for context)

\`\`\`diff
${patchDiff}
\`\`\`

## Your task

Write a regression test that:
1. Directly targets the vulnerability described above
2. Fails (RED) when the patch is **not** applied (i.e. the bug is still present)
3. Passes (GREEN) when the patch **is** applied

${testPathSection}After writing the file, report the exact path where you wrote it.
The path is required — the triad cannot verify the fix without it.`
}
