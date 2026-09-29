import type { ScanStrategy, StrategyContext, StrategyResult } from './types'

export class QuickStrategy implements ScanStrategy {
  readonly id = 'quick' as const

  async run(ctx: StrategyContext): Promise<StrategyResult> {
    ctx.onEvent({
      type: 'progress',
      message: `[${ctx.scanId}] Quick mode — skipping LLM stages`,
    })
    return { findings: ctx.classicalFindings, llmSkipped: true }
  }
}
