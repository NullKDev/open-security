/**
 * lib/pipeline/strategies/playbook.ts
 *
 * Playbook strategy — v0.3.
 *
 * Loads a named playbook manifest by `name@version`, interpolates the
 * prompt template with scan context variables, and runs stage2 LLM analysis.
 *
 * Fallback when playbook is not found:
 * - Emits a progress event with an error message
 * - Falls back to a standard stage2 prompt (no interpolation)
 */
import type { ScanStrategy, StrategyContext, StrategyResult } from './types'
import type { ScanModeId } from './types'
import { discoverPlaybooks } from '@/lib/playbooks/manifest-loader'
import { interpolate } from '@/lib/templates/interpolate'
import { runStage2Llm } from '../stage2-llm'
import { buildScanPrompt } from '@/lib/providers/stage-routing'

/**
 * Strategy that executes a named playbook against the target repository.
 *
 * The playbook is identified by a `name@version` reference (e.g. `find-ssrf@1.0.0`).
 * On construction, the reference is stored; the playbook is discovered lazily in `run()`.
 */
export class PlaybookStrategy implements ScanStrategy {
  readonly id: ScanModeId

  /**
   * @param playbookRef - The playbook reference string in `name@version` format
   *   (e.g. `find-ssrf@1.0.0`). The full scan mode id is `playbook:{ref}`.
   */
  constructor(private readonly playbookRef: string) {
    this.id = `playbook:${playbookRef}` as `playbook:${string}@${string}`
  }

  /**
   * Execute the playbook strategy.
   *
   * @param ctx - The strategy execution context.
   * @returns Strategy result with merged classical + LLM findings.
   */
  async run(ctx: StrategyContext): Promise<StrategyResult> {
    if (!ctx.llmProvider) {
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] Playbook mode — no LLM provider, returning classical findings only`,
      })
      return { findings: ctx.classicalFindings, llmSkipped: true }
    }

    // Step 1: Parse name and version from ref
    const atIdx = this.playbookRef.lastIndexOf('@')
    const playbookName = atIdx > 0 ? this.playbookRef.slice(0, atIdx) : this.playbookRef
    const playbookVersion = atIdx > 0 ? this.playbookRef.slice(atIdx + 1) : ''

    // Step 2: Discover and find matching playbook
    const playbooks = await discoverPlaybooks(ctx.workspaceRoot)
    const playbook = playbooks.find(
      (p) => p.id === playbookName && p.version === playbookVersion,
    )

    let prompt: string

    if (!playbook) {
      // Fallback: emit error event and use standard prompt
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] Playbook '${this.playbookRef}' not found — falling back to standard prompt`,
      })
      prompt = buildScanPrompt({
        stack: ctx.stage0Stack,
        userPrompt: ctx.prompt,
      })
    } else {
      // Step 3: Build interpolation vars — merge context + playbook parameter defaults
      const paramDefaults: Record<string, string> = {}
      if (playbook.parameters) {
        for (const [key, val] of Object.entries(playbook.parameters)) {
          if (typeof val === 'string') {
            paramDefaults[key] = val
          }
        }
      }

      const vars: Record<string, string> = {
        targetPath: ctx.targetPath,
        stack: ctx.stage0Stack.join(', '),
        scanId: ctx.scanId,
        ...paramDefaults,
      }

      // Step 4: Interpolate the playbook template
      prompt = interpolate(playbook.promptTemplate, vars)
    }

    // Step 5: Run stage2 LLM with the playbook prompt
    const stage2 = await runStage2Llm({
      scanId: ctx.scanId,
      targetPath: ctx.targetPath,
      provider: ctx.llmProvider,
      prompt,
      detectorPrefix: `llm:playbook:${playbookName}`,
      onEvent: ctx.onEvent,
    })

    return {
      findings: [...ctx.classicalFindings, ...stage2.findings],
      llmSkipped: false,
    }
  }
}
