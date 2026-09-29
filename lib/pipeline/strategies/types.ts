import type { ScanEvent } from '../events'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type { ProviderClient } from '@/lib/providers/index'
import type { ProjectMap } from '../project-map'

export type ScanModeId =
  | 'quick'
  | 'standard'
  | 'intermediate'
  | 'paranoid'
  /** v0.3: CVE hunt strategy */
  | 'hunt'
  /** v0.3: Named playbook strategy — format: `playbook:{name}@{version}` */
  | `playbook:${string}@${string}`

/** v0.2: Strategy identifier — extends ScanModeId with 'diff' */
export type ScanStrategyId = ScanModeId | 'diff'

/** v0.2: Diff scan context — changed files and commit SHAs */
export interface DiffContext {
  /** Base commit SHA (the PR base branch tip) */
  baseSha: string
  /** Head commit SHA (the PR feature branch tip) */
  headSha: string
  /** File paths that changed in this PR (relative to repo root) */
  changedFiles: string[]
}

/** Context passed by runner to every ScanStrategy.run() call. */
export interface StrategyContext {
  scanId: string
  workspaceRoot: string
  targetPath: string
  classicalFindings: NormalizedFinding[]
  stage0Stack: string[]
  /** Truncated file tree from Stage 0 (≤16 KB). Used in Pass 0 project intelligence. */
  fileTree?: string
  /** Representative source snippets sampled by Stage 0 (≤8 KB). */
  sampleSnippets?: string
  prompt?: string | null
  scanMode: ScanModeId
  llmProvider: ProviderClient | undefined
  onEvent: (event: ScanEvent) => void
  isAborted: () => boolean
  /** v0.2: Diff scan context. Present only when strategy = 'diff'. */
  diffContext?: DiffContext
}

export interface StrategyResult {
  /** Findings to forward to stage3 (classical + LLM, deduped, tagged). */
  findings: NormalizedFinding[]
  /** Persisted ProjectMap, if Pass 0 ran. Strategy is responsible for persistence. */
  projectMap?: ProjectMap
  /** True if no LLM provider was available and the strategy fell back to classical-only. */
  llmSkipped: boolean
}

export interface ScanStrategy {
  readonly id: ScanModeId
  run(ctx: StrategyContext): Promise<StrategyResult>
}
