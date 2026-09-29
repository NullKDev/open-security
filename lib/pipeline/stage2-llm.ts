import type { ScanEvent } from './events'
import type { ProviderClient, ProviderEvent } from '@/lib/providers/index'
import type { NormalizedFinding } from '@/lib/scanners/types'

export interface Stage2Opts {
  scanId: string
  targetPath: string
  provider: ProviderClient
  /** REQUIRED — strategy supplies the fully-built prompt */
  prompt: string
  /** Optional domain label stamped onto every emitted finding */
  domain?: string
  /** Default 'llm'; orchestrated strategies use 'llm:<domain>' */
  detectorPrefix?: string
  onEvent: (event: ScanEvent) => void
  /** Optional concurrency limit (default: 4) */
  concurrency?: number
}

export interface Stage2Result {
  findings: NormalizedFinding[]
  /** The domain this pass targeted, if any */
  domain?: string
}

/**
 * Stage 2 — LLM Scan
 *
 * Executes ONE LLM call with a fully-built prompt supplied by the calling strategy.
 * Streams findings as they arrive, stamping domain metadata and emitting events.
 *
 * Emits: stage events, finding events, progress events.
 * Does NOT throw — errors from the provider are emitted as error events.
 */
export async function runStage2Llm(opts: Stage2Opts): Promise<Stage2Result> {
  const { scanId, targetPath, provider, prompt, domain, detectorPrefix, onEvent } = opts

  onEvent({
    type: 'stage',
    stage: 'llm-scan',
    message: `[${scanId}] Starting LLM scan with provider ${provider.id}`,
  })

  // Emit capability metadata for UI badges
  onEvent({
    type: 'meta',
    providerId: provider.id,
    transport_kind: provider.capability.transportKind,
    thinkingSupport: provider.capability.thinkingSupport,
  })

  const findings: NormalizedFinding[] = []

  try {
    for await (const evt of provider.scan({ targetPath, promptOverride: prompt })) {
      handleProviderEvent(evt, findings, onEvent, domain, detectorPrefix)
    }
  } catch (err: unknown) {
    // Auth errors (401/403) are fatal — re-throw so the pipeline aborts.
    if (isAuthError(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message: `LLM provider error: ${message}` })
  }

  onEvent({
    type: 'stage',
    stage: 'llm-scan',
    message: `[${scanId}] LLM scan complete — ${findings.length} findings`,
  })

  return { findings, domain }
}

function handleProviderEvent(
  evt: ProviderEvent,
  findings: NormalizedFinding[],
  onEvent: (event: ScanEvent) => void,
  domain?: string,
  detectorPrefix?: string,
): void {
  switch (evt.type) {
    case 'progress':
      onEvent({ type: 'progress', message: evt.message, pct: evt.pct })
      break

    case 'finding': {
      const effectiveDetector = detectorPrefix ?? 'llm'
      const tags: string[] | undefined = domain ? [`domain:${domain}`] : undefined

      const finding: NormalizedFinding = {
        title: evt.title,
        description: evt.description,
        severity: normalizeSeverity(evt.severity),
        locationPath: evt.location ?? 'unknown',
        locationLineStart: 1,
        detector: effectiveDetector,
        tags,
      }
      findings.push(finding)
      onEvent({ type: 'finding', finding })
      break
    }

    case 'thinking':
      onEvent({ type: 'thinking', text: evt.text, format: evt.format ?? 'plain' })
      break

    case 'response':
      onEvent({ type: 'response', text: evt.text, format: evt.format ?? 'plain' })
      break

    case 'error':
      onEvent({ type: 'error', message: evt.message })
      break

    case 'tool_call':
      onEvent({
        type: 'tool_call',
        toolName: evt.toolName,
        toolCallId: evt.toolCallId,
        input: evt.input,
      })
      break

    case 'tool_result':
      onEvent({
        type: 'tool_result',
        toolCallId: evt.toolCallId,
        output: evt.output,
        isError: evt.isError,
        ...(evt.diffs && evt.diffs.length > 0 ? { diffs: evt.diffs } : {}),
      })
      break

    case 'permission_request':
      onEvent({
        type: 'permission_request',
        requestId: evt.requestId,
        toolName: evt.toolName,
        input: evt.input,
        timeoutMs: evt.timeoutMs,
      })
      break

    case 'cost':
      onEvent({
        type: 'cost',
        inputTokens: evt.inputTokens,
        outputTokens: evt.outputTokens,
        cacheReadTokens: evt.cacheReadTokens,
        cacheWriteTokens: evt.cacheWriteTokens,
        costUsd: evt.costUsd,
        contextSize: evt.contextSize,
        contextUsed: evt.contextUsed,
      })
      break

    case 'server_info':
      onEvent({
        type: 'server_info',
        agentId: evt.agentId,
        agentVersion: evt.agentVersion,
        capabilities: evt.capabilities,
      })
      break

    case 'file_read':
      onEvent({
        type: 'file_read',
        path: evt.path,
        preview: evt.preview,
      })
      break

    case 'file_write':
      onEvent({
        type: 'file_write',
        path: evt.path,
        preview: evt.preview,
      })
      break

    case 'terminal_output':
      onEvent({
        type: 'terminal_output',
        command: evt.command,
        output: evt.output,
        exitCode: evt.exitCode,
      })
      break

    case 'plan':
      onEvent({
        type: 'plan',
        steps: evt.steps,
      })
      break

    case 'stop_reason':
      onEvent({ type: 'stop_reason', reason: evt.reason })
      break

    case 'done':
      break
  }
}

function isAuthError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const status = (err as Record<string, unknown>).statusCode
    return status === 401 || status === 403
  }
  return false
}

type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

function normalizeSeverity(raw: string | undefined): Severity {
  const valid: Severity[] = ['info', 'low', 'medium', 'high', 'critical']
  if (raw && valid.includes(raw as Severity)) {
    return raw as Severity
  }
  return 'medium'
}
