/**
 * runner.ts — In-process pipeline runner
 *
 * Replaces the fork-based orchestrator for Next.js environments where
 * worker.js is not available (dev mode, edge runtime, etc.).
 *
 * Runs stages 0–5 sequentially in a background async task.
 * Events are published directly to the shared ScanBus — no IPC needed.
 */
import { eq, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import type { ScanBus } from './scan-bus'
import type { ScanEvent } from './events'
import { updateScanStatus } from '@/lib/repos/scans.repo'
import { insertScanEvent } from '@/lib/repos/scan-events.repo'
import { generateAllReports } from '@/lib/reports/generate-all'
import { ensureScanDirs } from '@/lib/config/workspace'
import { runStage0Prep } from './stage0-prep'
import { runStage1Classical } from './stage1-classical'
import { runStage3Validate } from './stage3-validate'
import { runStage4Filter } from './stage4-filter'
import { runStage5Patch, type PatchResult } from './stage5-patch'
import { insertFinding, updateFinding } from '@/lib/repos/findings.repo'
import { normalizeScanMode, selectStrategy } from './strategies'
import type { ScanStrategyId } from './strategies'
import { enrichScan } from '@/lib/enrichment/service'
import { OBT_ROOT } from '@/lib/config/store'
import * as path from 'node:path'
import type { StrategyContext } from './strategies/types'
import { persistProjectMap } from './project-map'
import type { SourceKind } from './stage0-prep'

type DB = BetterSQLite3Database<typeof schema>

export type ScanMode = 'quick' | 'standard' | 'intermediate' | 'paranoid'

export interface RunnerOpts {
  db: DB
  scanId: string
  projectId: string
  sourceKind: string
  sourceRef: string
  workspaceRoot: string
  bus: ScanBus
  prompt?: string | null
  scanMode?: ScanMode
  /** v0.2: override strategy (e.g. 'diff'); takes precedence over scanMode */
  strategy?: ScanStrategyId
  /** v0.2: diff context (changedFiles, baseSha, headSha) for diff scans */
  diffContext?: import('./strategies').DiffContext
  onComplete?: (scanId: string, status: 'done' | 'failed') => void
}

export interface RunnerHandle {
  done: Promise<void>
  abort: () => void
}

export function runPipeline(opts: RunnerOpts): RunnerHandle {
  const { db, scanId, projectId, sourceKind, sourceRef, workspaceRoot, bus, prompt, scanMode = 'standard', strategy: strategyOverride, diffContext, onComplete } = opts

  let aborted = false

  function publish(event: ScanEvent): void {
    if (aborted) return
    bus.publish(scanId, event)
    persistEvent(db, scanId, event)
  }

  try {
    updateScanStatus(db, scanId, 'running')
    ensureScanDirs(projectId, scanId)
  } catch {
    // Non-critical — DB may not be available in all contexts
  }

  const done = (async () => {
    try {
      const stage0 = await runStage0Prep({
        scanId,
        sourceKind: sourceKind as SourceKind,
        sourceRef,
        workspaceRoot,
        onEvent: publish,
      })

      if (!stage0.ok || aborted) {
        try { updateScanStatus(db, scanId, 'failed', 'Source preparation failed') } catch { /* ignore */ }
        onComplete?.(scanId, 'failed')
        return
      }

      const targetPath = `${workspaceRoot}/source`

      // v0.2: diff scans narrow stage 1 to scopeFiles and skip OSV
      const isDiff = strategyOverride === 'diff'
      const scopeFiles = isDiff && diffContext ? diffContext.changedFiles : undefined
      const stage1 = await runStage1Classical({
        scanId,
        targetPath,
        onEvent: publish,
        scopeFiles,
        skipScanners: isDiff ? ['osv'] : undefined,
      })

      if (aborted) return

      // Normalize scan mode (legacy 'deep' → 'paranoid', unknown → 'standard' + warn)
      const mode = normalizeScanMode(scanMode, (msg) => publish({ type: 'progress', message: msg }))

      // Select strategy: explicit override (e.g. 'diff') takes precedence over mode
      const strategy = await selectStrategy(strategyOverride ?? mode)
      const { createProviderForStage } = await import('@/lib/providers/stage-routing')
      const provider = createProviderForStage('llm-scan')

      // Persist which models were resolved for each stage — audit trail
      persistModelsUsed(db, scanId)

      const ctx: StrategyContext = {
        scanId,
        workspaceRoot,
        targetPath,
        classicalFindings: stage1.findings,
        stage0Stack: stage0.stackHints ?? [],
        fileTree: stage0.fileTree,
        sampleSnippets: stage0.sampleSnippets,
        prompt,
        scanMode: mode,
        llmProvider: provider,
        onEvent: publish,
        isAborted: () => aborted,
        diffContext,
      }

      const result = await strategy.run(ctx)
      if (aborted) return

      // Persist ProjectMap if the strategy produced one (orchestrated modes)
      if (result.projectMap) {
        await persistProjectMap(db, scanId, workspaceRoot, result.projectMap)
      }

      if (result.llmSkipped || !provider) {
        // Classical-only — skip LLM validation/patching stages
        if (!result.llmSkipped && !provider) {
          publish({
            type: 'progress',
            message: `[${scanId}] No LLM provider configured — skipping LLM stages`,
          })
        }
        const stage4 = await runStage4Filter({
          scanId,
          validated: result.findings.map((f) => ({
            finding: f,
            passes: true,
            rationale: 'classical',
            model: 'none',
          })),
          onEvent: publish,
          _scannersManifest: stage1.scannersManifest,
        })
        if (aborted) return
        for (const finding of stage4.filtered) {
          publish({ type: 'finding', finding })
        }
      } else {
        // Full LLM pipeline: validate → filter → patch
        const validateProvider = createProviderForStage('validate') ?? provider
        const stage3 = await runStage3Validate({
          scanId,
          findings: result.findings,
          provider: validateProvider,
          targetPath,
          onEvent: publish,
        })
        if (aborted) return

        const stage4 = await runStage4Filter({ scanId, validated: stage3.validated, onEvent: publish, _scannersManifest: stage1.scannersManifest })
        if (aborted) return

        const patchProvider = createProviderForStage('patch') ?? provider
        const stage5 = await runStage5Patch({ scanId, findings: stage4.filtered, provider: patchProvider, targetPath, onEvent: publish })
        // Persist generated patches to the findings table
        persistPatches(db, stage5.patches)
      }

      if (!aborted) {
        // v0.4: regression detection + posture refresh + notifications (non-blocking)
        try {
          const { runRegressionDetect } = await import('@/lib/dedup/post-hooks/regression-detect')
          runRegressionDetect(db, scanId)
        } catch {
          // Non-critical — scan stays valid even if regression detection fails
        }

        try {
          const { refreshPosture } = await import('@/lib/posture/refresh')
          refreshPosture(db, projectId, scanId)
        } catch {
          // Non-critical — posture refresh failure must not fail the scan
        }

        // v0.2: post PR comment for diff scans (fire-and-forget, never blocks completion)
        if (strategyOverride === 'diff' && diffContext) {
          void postPrCommentIfApplicable(db, scanId).catch(() => {
            // Comment failures must not fail the scan — mark comment_status=failed in DB
          })
        }

        // Fire-and-forget enrichment (never blocks scan completion)
        const kevCacheDir = path.join(OBT_ROOT, 'cache')
        void enrichScan(db, scanId, kevCacheDir).catch((err) => {
          console.warn('[enrichment] post-scan enrichment error:', err)
        })

        // Persist all report formats to workspaceRoot/reports/ before signalling done
        try {
          await generateAllReports(db, scanId, workspaceRoot)
        } catch {
          // Non-critical — scan is still valid even if report generation fails
        }

        publish({ type: 'done', scanId })
        try {
          updateScanStatus(db, scanId, 'done')
        } catch {
          // Ignore
        }
        bus.destroy(scanId)
        onComplete?.(scanId, 'done')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      publish({ type: 'error', message: `Pipeline error: ${message}` })
      try {
        updateScanStatus(db, scanId, 'failed', message)
      } catch {
        // Ignore
      }
      onComplete?.(scanId, 'failed')
    }
  })()

  return {
    done,
    abort: () => {
      aborted = true
    },
  }
}

/**
 * Post a PR comment with scan findings after a diff scan completes.
 * Updates prCommentStatus on the scan row regardless of success/failure.
 *
 * @param db - Drizzle database instance
 * @param scanId - Completed scan ID
 */
async function postPrCommentIfApplicable(db: DB, scanId: string): Promise<void> {
  try {
    const { getScanById, getMostRecentCompletedScan, getDeltaFindings } = await import('@/lib/repos/scans.repo')
    const { getProjectById } = await import('@/lib/repos/projects.repo')
    const { postPrComment } = await import('@/lib/integrations/github/pr-comment')

    const scan = getScanById(db, scanId)
    if (!scan || !scan.prNumber) return

    const project = getProjectById(db, scan.projectId)
    if (!project) return

    // Parse owner/repo from sourceRef
    const ownerRepoMatch = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(project.sourceRef)
    if (!ownerRepoMatch) return
    const [, owner, repo] = ownerRepoMatch

    // Get delta findings vs parent
    const parentScan = getMostRecentCompletedScan(db, scan.projectId)
    const findings = parentScan
      ? getDeltaFindings(db, scanId, parentScan.id)
      : getDeltaFindings(db, scanId, scanId) // no parent → all findings are "new"

    await postPrComment(owner, repo, scan.prNumber, findings, scanId)

    // Mark comment as posted
    db.update(schema.scans)
      .set({ prCommentStatus: 'posted' })
      .where(eq(schema.scans.id, scanId))
      .run()
  } catch {
    // Mark comment as failed (scan stays 'done')
    try {
      db.update(schema.scans)
        .set({ prCommentStatus: 'failed' })
        .where(eq(schema.scans.id, scanId))
        .run()
    } catch {
      // Non-critical
    }
  }
}

function persistEvent(db: DB, scanId: string, event: ScanEvent): void {
  try {
    switch (event.type) {
      case 'stage':
        db.update(schema.scans)
          .set({ stage: event.stage })
          .where(eq(schema.scans.id, scanId))
          .run()
        break

      case 'finding':
        // Use dedup-aware insertFinding instead of raw insert (Design §8)
        insertFinding(db, {
          scanId,
          detector: event.finding.detector,
          severity: event.finding.severity,
          confidence: 0.8,
          title: event.finding.title,
          description: event.finding.description ?? '',
          locationPath: event.finding.locationPath,
          locationLineStart: event.finding.locationLineStart,
          locationLineEnd: event.finding.locationLineEnd ?? null,
        })
        break

      default:
        break
    }

    // Persist high-priority events to scan_events for post-restart replay
    insertScanEvent(db, scanId, event)
  } catch {
    // Non-critical
  }
}

/**
 * Snapshot which models are currently configured for each pipeline stage
 * and persist to scans.models_used as a JSON string.
 *
 * Called once at pipeline start — provides an audit trail of what models
 * produced the findings in this scan.
 */
async function persistModelsUsed(db: DB, scanId: string): Promise<void> {
  try {
    const { createProviderForStage } = await import('@/lib/providers/stage-routing')
    const stages = ['llm-scan', 'validate', 'filter', 'patch'] as const
    const resolved: Record<string, string | null> = {}

    for (const stage of stages) {
      const client = createProviderForStage(stage)
      resolved[stage] = client?.id ?? null
    }

    db.update(schema.scans)
      .set({ modelsUsed: JSON.stringify(resolved) })
      .where(eq(schema.scans.id, scanId))
      .run()
  } catch {
    // Non-critical — models_used is an audit trail, not a functional requirement
  }
}

/**
 * Persist generated patches from Stage 5 into the findings table.
 * Matches findings by title + locationPath + locationLineStart since
 * the DB ID is generated during event persistence, not available in
 * the NormalizedFinding objects that Stage 5 receives.
 */
function persistPatches(db: DB, patches: PatchResult[]): void {
  for (const p of patches) {
    if (!p.patchDiff && !p.patchExplanation) continue
    try {
      const f = p.finding
      db.update(schema.findings)
        .set({
          patchDiff: p.patchDiff,
          patchExplanation: p.patchExplanation,
          patchGeneratedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.findings.title, f.title),
            eq(schema.findings.locationPath, f.locationPath),
            eq(schema.findings.locationLineStart, f.locationLineStart),
          ),
        )
        .run()
    } catch {
      // Non-critical
    }
  }
}
