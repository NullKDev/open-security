import type { ScanStrategy, StrategyContext, StrategyResult } from './types'
import { buildScanPrompt } from '@/lib/providers/stage-routing'
import { runStage2Llm } from '../stage2-llm'

export class StandardStrategy implements ScanStrategy {
  readonly id = 'standard' as const

  async run(ctx: StrategyContext): Promise<StrategyResult> {
    if (!ctx.llmProvider) {
      ctx.onEvent({
        type: 'progress',
        message: `[${ctx.scanId}] No LLM provider — returning classical findings only`,
      })
      return { findings: ctx.classicalFindings, llmSkipped: true }
    }

    const prompt = buildScanPrompt({
      stack: ctx.stage0Stack,
      userPrompt: ctx.prompt,
    })

    const stage2 = await runStage2Llm({
      scanId: ctx.scanId,
      targetPath: ctx.targetPath,
      provider: ctx.llmProvider,
      prompt,
      onEvent: ctx.onEvent,
    })

    return {
      findings: [...ctx.classicalFindings, ...stage2.findings],
      llmSkipped: false,
    }
  }
}
