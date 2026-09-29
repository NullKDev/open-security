/**
 * lib/pipeline/strategies/diff.ts
 *
 * Diff scan strategy — narrows stage 1 results to changed files + 1-hop importers.
 *
 * Design decisions:
 * - No LLM in diff mode (too slow, defeats the 30s performance budget)
 * - OSV-scanner is skipped in diff scope (dependency scan is full-repo, not per-file)
 * - classicalFindings are pre-filtered by stage 1 (scopeFiles param) — this strategy
 *   just forwards them and marks llmSkipped = true
 * - diffContext on StrategyContext carries changedFiles for use by stage 1 caller
 */

import type { ScanStrategy, StrategyContext, StrategyResult } from './types'

/**
 * Diff scan strategy. Runs classical scanners only on the changed file set
 * (pre-filtered by stage 1 via scopeFiles). Always skips LLM to stay within
 * the 30s diff scan performance budget.
 */
export class DiffStrategy implements ScanStrategy {
  readonly id = 'diff' as const

  async run(ctx: StrategyContext): Promise<StrategyResult> {
    const { scanId, classicalFindings, onEvent, diffContext } = ctx

    const scopeNote = diffContext
      ? ` (${diffContext.changedFiles.length} changed files, ${diffContext.baseSha.slice(0, 7)}→${diffContext.headSha.slice(0, 7)})`
      : ''

    onEvent({
      type: 'progress',
      message: `[${scanId}] Diff mode — skipping LLM, returning ${classicalFindings.length} classical findings${scopeNote}`,
    })

    return {
      findings: classicalFindings,
      llmSkipped: true,
    }
  }
}
