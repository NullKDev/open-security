/**
 * worker.ts — Pipeline worker process entry point
 *
 * This module is designed to run as a forked child process via `orchestrator.ts`.
 * It executes stages 0–5 sequentially and sends `ScanEvent` objects back to the
 * parent via `process.send()`.
 *
 * Environment variables (set by orchestrator):
 *   OBT_SCAN_ID       — scan ID
 *   OBT_SOURCE_KIND   — local | github | gitlab | zip
 *   OBT_SOURCE_REF    — path/URL/identifier
 *   OBT_WORKSPACE     — absolute path to workspace directory
 *   OBT_PROVIDER_ID   — provider config string (e.g. "api:anthropic:claude-sonnet-4")
 *
 * IPC protocol: each message is a serialized ScanEvent object.
 */
import { runStage0Prep } from './stage0-prep'
import { runStage1Classical } from './stage1-classical'
import { runStage2Llm } from './stage2-llm'
import { runStage3Validate } from './stage3-validate'
import { runStage4Filter } from './stage4-filter'
import { runStage5Patch } from './stage5-patch'
import type { ScanEvent } from './events'
import type { SourceKind } from './stage0-prep'

/** Send an event to the parent process via IPC */
function sendEvent(event: ScanEvent): void {
  if (process.send) {
    process.send(event)
  }
}

/** Get a required environment variable or throw */
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

/** SIGTERM handler — attempt graceful shutdown, SIGKILL after 5s */
function installSigtermHandler(): void {
  process.on('SIGTERM', () => {
    sendEvent({ type: 'error', message: 'Worker received SIGTERM — shutting down' })
    const timer = setTimeout(() => {
      process.exit(1)
    }, 5000)
    // Allow the process to exit naturally if it finishes before 5s
    if (timer.unref) timer.unref()
  })
}

async function main(): Promise<void> {
  installSigtermHandler()

  const scanId = requireEnv('OBT_SCAN_ID')
  const sourceKind = requireEnv('OBT_SOURCE_KIND') as SourceKind
  const sourceRef = requireEnv('OBT_SOURCE_REF')
  const workspaceRoot = requireEnv('OBT_WORKSPACE')

  const onEvent = sendEvent

  // ── Stage 0 — Source preparation ────────────────────────────────────────────
  const stage0 = await runStage0Prep({ scanId, sourceKind, sourceRef, workspaceRoot, onEvent })
  if (!stage0.ok) {
    sendEvent({ type: 'error', message: 'Source preparation failed — aborting pipeline' })
    process.exit(1)
  }

  const targetPath = `${workspaceRoot}/source`

  // ── Stage 1 — Classical scanners ────────────────────────────────────────────
  const stage1 = await runStage1Classical({ scanId, targetPath, onEvent })

  // ── Stage 2 — LLM scan ─────────────────────────────────────────────────────
  // Provider is optional — if not configured, skip LLM stages
  const providerStr = process.env['OBT_PROVIDER_ID']
  let allFindings = stage1.findings

  if (providerStr) {
    const { createProviderForStage } = await import('@/lib/providers/stage-routing')
    const provider = createProviderForStage('llm-scan')

    if (provider) {
      const stage2 = await runStage2Llm({ scanId, targetPath, provider, prompt: 'Analyze the codebase for security vulnerabilities.', onEvent })
      allFindings = [...allFindings, ...stage2.findings]

      // ── Stage 3 — Validation ───────────────────────────────────────────────
      const validateProvider = createProviderForStage('validate') ?? provider
      const stage3 = await runStage3Validate({
        scanId,
        findings: allFindings,
        provider: validateProvider,
        targetPath,
        onEvent,
      })

      // ── Stage 4 — FP Filter ────────────────────────────────────────────────
      const stage4 = await runStage4Filter({ scanId, validated: stage3.validated, onEvent })

      // ── Stage 5 — Patch synthesis ──────────────────────────────────────────
      const patchProvider = createProviderForStage('patch') ?? provider
      await runStage5Patch({
        scanId,
        findings: stage4.filtered,
        provider: patchProvider,
        targetPath,
        onEvent,
      })
    }
  } else {
    // No LLM — run stages 3-5 with empty sets (passthrough)
    const stage4 = await runStage4Filter({
      scanId,
      validated: allFindings.map((finding) => ({ finding, passes: true, rationale: 'classical', model: 'none' })),
      onEvent,
    })
    onEvent({
      type: 'stage',
      stage: 'patch',
      message: `[${scanId}] No LLM provider configured — skipping patch synthesis`,
    })
    // Emit findings for DB persistence
    for (const finding of stage4.filtered) {
      onEvent({ type: 'finding', finding })
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────────
  onEvent({ type: 'done', scanId })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  sendEvent({ type: 'error', message: `Worker fatal error: ${message}` })
  process.exit(1)
})
