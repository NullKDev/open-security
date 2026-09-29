import type { ScanStrategy, StrategyContext, StrategyResult } from './types'
import type { ProjectMap } from '../project-map'
import { generateProjectMap, defaultProjectMapFromStack } from '../project-map'
import { buildScanPrompt } from '@/lib/providers/stage-routing'
import { runStage2Llm } from '../stage2-llm'
import { dedupeFindings } from './dedupe'
import { listAllDetectors } from '@/lib/detectors/loader'

export class OrchestratedStrategy implements ScanStrategy {
  readonly id: 'intermediate' | 'paranoid'
  private readonly variant: 'intermediate' | 'paranoid'

  constructor(variant: 'intermediate' | 'paranoid') {
    this.variant = variant
    this.id = variant
  }

  async run(ctx: StrategyContext): Promise<StrategyResult> {
    if (!ctx.llmProvider) {
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] No LLM provider — returning classical findings only`,
      })
      return { findings: ctx.classicalFindings, llmSkipped: true }
    }

    // Load all detectors once — used per domain
    const allDetectors = listAllDetectors()

    // Pass 0 — Generate ProjectMap
    let projectMap: ProjectMap
    try {
      projectMap = await generateProjectMap(ctx.llmProvider, ctx, this.variant)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] Pass 0 failed: ${msg} — falling back to default project map`,
      })
      projectMap = defaultProjectMapFromStack(ctx.stage0Stack, this.variant)
    }

    // Cap domains per variant. Paranoid gets all domains from the ProjectMap (up to 10).
    const maxDomains = this.variant === 'intermediate' ? 4 : 10
    const domains = projectMap.domains.slice(0, maxDomains)

    const allFindings: typeof ctx.classicalFindings = [...ctx.classicalFindings]

    // Per-domain sequential scan
    for (const domain of domains) {
      if (ctx.isAborted()) {
        ctx.onEvent({
          type: 'progress',
          message: `[${ctx.scanId}] Scan aborted mid-loop — stopping domain scans`,
        })
        break
      }

      // Load detectors for this domain to inject into the prompt.
      // Exact match first. If none (LLM generates a domain name that doesn't
      // correspond to a detector directory), try keyword matching. If still
      // nothing, inject ALL detector domains as general hints.
      const domainDetectors = allDetectors.filter((d) => d.domain === domain)
      const matchedDetectors = domainDetectors.length > 0
        ? domainDetectors
        : allDetectors.filter((d) =>
            domain.split(/[- ]/).some((word) =>
              word.length > 2 && (d.domain.includes(word) || d.meta.id.includes(word))
            ),
          )
      const effectiveDetectors = matchedDetectors.length > 0 ? matchedDetectors : allDetectors

      // Paranoid: inject full detection prompts from SKILL.md so the LLM knows
      // exactly what to look for. Intermediate: inject summaries only.
      const detectorHints = this.variant === 'paranoid'
        ? effectiveDetectors
            .map((d) => [
              `### ${d.meta.id} [${d.meta.severity}]`,
              d.meta.description,
              d.detectionPrompt ? `\nInstructions:\n${d.detectionPrompt}` : '',
            ].join('\n'))
            .join('\n\n')
        : effectiveDetectors
            .map((d) => `  - ${d.meta.id} [${d.meta.severity}]: ${d.meta.description}`)
            .join('\n')

      try {
        const prompt = buildScanPrompt({
          stack: projectMap.stack,
          domain,
          includeFixSuggestions: this.variant === 'paranoid',
          scanDepth: this.variant === 'paranoid' ? 'paranoid' : 'standard',
          detectorHints,
        })

        const stage2 = await runStage2Llm({
          scanId: ctx.scanId,
          targetPath: ctx.targetPath,
          provider: ctx.llmProvider,
          prompt,
          domain,
          detectorPrefix: `llm:${domain}`,
          onEvent: ctx.onEvent,
        })

        allFindings.push(...stage2.findings)
      } catch (err: unknown) {
        // Hard error per domain — warn and continue
        const msg = err instanceof Error ? err.message : String(err)
        ctx.onEvent({
          type: 'progress',
          message: `[${ctx.scanId}] Domain '${domain}' scan failed: ${msg} — continuing with remaining domains`,
        })

        // Re-throw auth errors (401/403) — those are fatal
        if (isAuthError(err)) throw err
      }
    }

    return {
      findings: dedupeFindings(allFindings),
      projectMap,
      llmSkipped: false,
    }
  }
}

function isAuthError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const status = (err as Record<string, unknown>).statusCode
    return status === 401 || status === 403
  }
  return false
}
