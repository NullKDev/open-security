/**
 * test-runner.ts — Runs the project's test suite after branch application
 *
 * The test command is shell-evaluated by design (user-provided, per Design §5).
 * This is the gated exception to the no-shell rule — the user typed the command
 * and confirmed via the UI dialog.
 *
 * Constraints:
 * - Shell: true (user command may contain pipes, &&, etc.)
 * - Timeout: 600 seconds
 * - Output: last 2000 chars of combined stdout+stderr
 * - Never throws: errors are caught and returned in the result
 */
import * as childProcess from 'node:child_process'

const TEST_TIMEOUT_MS = 600_000
const MAX_OUTPUT_CHARS = 2000

export interface TestRunResult {
  /** True if the test command exited with code 0 */
  passed: boolean
  /** Last 2000 chars of combined stdout + stderr */
  output: string
  /** Raw exit code from the process */
  exitCode: number
}

/**
 * Truncates a string to the last `maxChars` characters.
 * Used to keep test output within a reasonable storage size.
 *
 * @param str - The string to potentially truncate
 * @param maxChars - Maximum characters to keep (default: 2000)
 * @returns The (possibly truncated) string
 */
export function truncateOutput(str: string, maxChars = MAX_OUTPUT_CHARS): string {
  if (str.length <= maxChars) return str
  return str.slice(str.length - maxChars)
}

/**
 * Spawns the user-provided test command in the given directory.
 *
 * Uses `shell: true` because the test command is user-authored and may
 * contain shell constructs (pipes, && operators, etc.).
 *
 * @param cwd - Repository working directory
 * @param testCommand - Shell command to run (e.g. "npm test", "bun test")
 * @returns TestRunResult with passed status, output, and exit code
 */
export function runTestCommand(cwd: string, testCommand: string): Promise<TestRunResult> {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(testCommand, [], {
      cwd,
      shell: true,
      timeout: TEST_TIMEOUT_MS,
    })

    let combined = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      combined += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      combined += chunk.toString()
    })

    proc.on('close', (code) => {
      const exitCode = code ?? 1
      resolve({
        passed: exitCode === 0,
        output: truncateOutput(combined),
        exitCode,
      })
    })
  })
}
