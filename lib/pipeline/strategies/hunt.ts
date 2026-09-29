/**
 * lib/pipeline/strategies/hunt.ts
 *
 * CVE hunt strategy — v0.3.
 *
 * Fetches advisory metadata from OSV, classifies the CVE, builds a targeted
 * hunt prompt, runs stage2 LLM analysis, and persists the verdict.
 *
 * Fallback behaviour when OSV returns null:
 * - classifyAdvisory is skipped
 * - cveClass is set to 'generic'
 * - hunt continues with the generic prompt template
 */
import type { ScanStrategy, StrategyContext, StrategyResult } from './types'
import { fetchAdvisory } from '@/lib/advisories/osv-client'
import { classifyAdvisory } from '@/lib/advisories/cve-class'
import { buildHuntPrompt } from '@/lib/hunt/hunt-context'
import { runStage2Llm } from '../stage2-llm'
import { upsertHuntTarget } from '@/lib/repos/hunt-targets.repo'
import { getDb } from '@/lib/db/client'
import { randomUUID } from 'node:crypto'

/**
 * Strategy that hunts for a specific CVE across the target repository.
 *
 * Lifecycle:
 * 1. `run()` resolves the cveId from the constructor arg (tests) or `ctx.prompt`.
 * 2. Fetches the OSV advisory for the CVE ID (if available).
 * 3. Classifies the advisory into a {@link CveClass}.
 * 4. Builds a targeted hunt prompt via {@link buildHuntPrompt}.
 * 5. Runs the stage2 LLM analysis with the hunt prompt.
 * 6. Persists the hunt verdict via {@link upsertHuntTarget}.
 */
export class HuntStrategy implements ScanStrategy {
  readonly id = 'hunt' as const

  /**
   * @param cveId - Optional CVE or GHSA identifier. When omitted, `ctx.prompt`
   *   is used as the cveId at `run()` time (runtime injection from scan options).
   */
  constructor(private readonly cveId?: string) {}

  /**
   * Execute the CVE hunt strategy.
   *
   * @param ctx - The strategy execution context.
   * @returns Strategy result with merged classical + LLM findings.
   */
  async run(ctx: StrategyContext): Promise<StrategyResult> {
    if (!ctx.llmProvider) {
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] Hunt mode — no LLM provider, returning classical findings only`,
      })
      return { findings: ctx.classicalFindings, llmSkipped: true }
    }

    // Resolve cveId: explicit constructor arg takes precedence, else use ctx.prompt
    const cveId = this.cveId ?? ctx.prompt ?? ''

    // Step 1: Fetch advisory from OSV (null on 404 or network error)
    const advisory = await fetchAdvisory(cveId)

    // Step 2: Classify advisory → CveClass (fallback to 'generic' on null advisory)
    const cveClass = advisory !== null ? classifyAdvisory(advisory) : 'generic'

    // Step 3: Build the hunt prompt
    const huntPrompt = buildHuntPrompt({
      cveId,
      cveClass,
      summary: advisory?.summary,
      details: advisory?.details,
      pocUrl: advisory?.pocUrl ?? null,
      targetPath: ctx.targetPath,
      packageName: advisory?.packageName,
    })

    // Step 4: Run stage2 LLM with the hunt prompt
    const stage2 = await runStage2Llm({
      scanId: ctx.scanId,
      targetPath: ctx.targetPath,
      provider: ctx.llmProvider,
      prompt: huntPrompt,
      detectorPrefix: 'llm:hunt',
      onEvent: ctx.onEvent,
    })

    // Step 5: Persist verdict
    const db = getDb()
    const verdict = stage2.findings.length > 0 ? 'exposed' : 'not-exposed'
    upsertHuntTarget(db, ctx.scanId, {
      id: randomUUID(),
      cveId,
      targetPath: ctx.targetPath,
      advisoryRaw: advisory !== null ? JSON.stringify(advisory) : null,
      verdict,
    })

    return {
      findings: [...ctx.classicalFindings, ...stage2.findings],
      llmSkipped: false,
    }
  }
}
