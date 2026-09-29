import { z } from 'zod'
import type { NormalizedFinding } from '@/lib/scanners/types'

// ─── NormalizedFinding schema (for Zod validation at boundaries) ─────────────

const normalizedFindingSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  locationPath: z.string(),
  locationLineStart: z.number().int(),
  locationLineEnd: z.number().int().optional(),
  locationCommit: z.string().optional(),
  detector: z.string(),
  tags: z.array(z.string()).optional(),
})

// ─── Event schemas ────────────────────────────────────────────────────────────

const stageEventSchema = z.object({
  type: z.literal('stage'),
  stage: z.string(),
  message: z.string(),
})

const progressEventSchema = z.object({
  type: z.literal('progress'),
  message: z.string(),
  pct: z.number().min(0).max(100).optional(),
})

const findingEventSchema = z.object({
  type: z.literal('finding'),
  finding: normalizedFindingSchema,
})

const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
})

const doneEventSchema = z.object({
  type: z.literal('done'),
  scanId: z.string(),
})

const thinkingEventSchema = z.object({
  type: z.literal('thinking'),
  text: z.string(),
  format: z.enum(['markdown', 'plain']).optional().default('plain'),
  /** ACP messageId (UNSTABLE) — group chunks with the same ID into one block. */
  messageId: z.string().optional(),
})

const responseEventSchema = z.object({
  type: z.literal('response'),
  text: z.string(),
  format: z.enum(['markdown', 'plain']).optional().default('plain'),
  /** ACP messageId (UNSTABLE) — group chunks with the same ID into one message. */
  messageId: z.string().optional(),
})

const metaEventSchema = z.object({
  type: z.literal('meta'),
  providerId: z.string(),
  transport_kind: z.enum(['sdk', 'http', 'acp', 'api-sdk']).optional(),
  thinkingSupport: z.boolean().optional(),
})

const toolLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().optional(),
})

const toolCallEventSchema = z.object({
  type: z.literal('tool_call'),
  toolName: z.string(),
  toolCallId: z.string(),
  /** ACP `kind` field — used to pick icon and rendering strategy. */
  kind: z.enum(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']).optional(),
  /** Files the tool is operating on. */
  locations: z.array(toolLocationSchema).optional(),
  input: z.unknown(),
})

const diffSchema = z.object({
  path: z.string(),
  newText: z.string(),
  oldText: z.string().nullable().optional(),
})

const toolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  toolCallId: z.string(),
  output: z.unknown(),
  isError: z.boolean().default(false),
  /** File diffs from ACP ToolCallContent diff entries. */
  diffs: z.array(diffSchema).optional(),
})

const permissionRequestEventSchema = z.object({
  type: z.literal('permission_request'),
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  timeoutMs: z.number().default(60000),
})

const costEventSchema = z.object({
  type: z.literal('cost'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  /** Total context window size in tokens (ACP UsageUpdate.size). */
  contextSize: z.number().int().nonnegative().optional(),
  /** Tokens currently in use in the context window (ACP UsageUpdate.used). */
  contextUsed: z.number().int().nonnegative().optional(),
})

const serverInfoEventSchema = z.object({
  type: z.literal('server_info'),
  agentId: z.string(),
  agentVersion: z.string().optional(),
  capabilities: z.unknown().optional(),
})

const fileReadEventSchema = z.object({
  type: z.literal('file_read'),
  path: z.string().min(1),
  preview: z.string().optional(),
})

const fileWriteEventSchema = z.object({
  type: z.literal('file_write'),
  path: z.string().min(1),
  preview: z.string().optional(),
})

const terminalOutputEventSchema = z.object({
  type: z.literal('terminal_output'),
  command: z.string().optional(),
  output: z.string(),
  exitCode: z.number().int().optional(),
})

const planEventSchema = z.object({
  type: z.literal('plan'),
  steps: z.array(z.object({
    title: z.string(),
    status: z.enum(['pending', 'in_progress', 'done', 'error']),
  })).nonempty(),
})

const stopReasonEventSchema = z.object({
  type: z.literal('stop_reason'),
  /** ACP StopReason — why the agent stopped this turn. */
  reason: z.enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']),
})

// ─── v0.3: Investigation Console event schemas ────────────────────────────────

const userInjectionEventSchema = z.object({
  type: z.literal('user_injection'),
  /** The user-provided content injected into the running scan. */
  content: z.string(),
  /** Component that triggered the injection (e.g. 'user-console' | 'playbook'). */
  injectionSource: z.string().optional(),
})

const planEditEventSchema = z.object({
  type: z.literal('plan_edit'),
  /** Zero-based index of the plan step being edited. */
  stepIndex: z.number().int(),
  /** New content for the plan step. */
  newContent: z.string(),
})

const toolCallRejectedEventSchema = z.object({
  type: z.literal('tool_call_rejected'),
  /** The id of the tool call that was rejected. */
  toolCallId: z.string(),
  /** Optional human-readable reason for the rejection. */
  reason: z.string().optional(),
})

const forkPointEventSchema = z.object({
  type: z.literal('fork_point'),
  /** The id of the fork record in scan_forks. */
  forkId: z.string(),
  /** The scan that was forked from. */
  parentScanId: z.string(),
})

export const scanEventSchema = z.discriminatedUnion('type', [
  stageEventSchema,
  progressEventSchema,
  findingEventSchema,
  errorEventSchema,
  doneEventSchema,
  thinkingEventSchema,
  responseEventSchema,
  metaEventSchema,
  toolCallEventSchema,
  toolResultEventSchema,
  permissionRequestEventSchema,
  costEventSchema,
  serverInfoEventSchema,
  fileReadEventSchema,
  fileWriteEventSchema,
  terminalOutputEventSchema,
  planEventSchema,
  stopReasonEventSchema,
  userInjectionEventSchema,
  planEditEventSchema,
  toolCallRejectedEventSchema,
  forkPointEventSchema,
])

// ─── TypeScript types inferred from schemas ───────────────────────────────────

export type StageEvent = z.infer<typeof stageEventSchema>
export type ProgressEvent = z.infer<typeof progressEventSchema>
export type FindingEvent = z.infer<typeof findingEventSchema> & {
  finding: NormalizedFinding
}
export type ErrorEvent = z.infer<typeof errorEventSchema>
export type DoneEvent = z.infer<typeof doneEventSchema>
export type ThinkingEvent = z.infer<typeof thinkingEventSchema>

export type ResponseEvent = z.infer<typeof responseEventSchema>

export type MetaEvent = z.infer<typeof metaEventSchema>

export type ToolCallEvent = z.infer<typeof toolCallEventSchema>
export type ToolResultEvent = z.infer<typeof toolResultEventSchema>
export type PermissionRequestEvent = z.infer<typeof permissionRequestEventSchema>
export type CostEvent = z.infer<typeof costEventSchema>
export type ServerInfoEvent = z.infer<typeof serverInfoEventSchema>
export type FileReadEvent = z.infer<typeof fileReadEventSchema>
export type FileWriteEvent = z.infer<typeof fileWriteEventSchema>
export type TerminalOutputEvent = z.infer<typeof terminalOutputEventSchema>
export type PlanEvent = z.infer<typeof planEventSchema>
export type StopReasonEvent = z.infer<typeof stopReasonEventSchema>

// ─── v0.3: Investigation Console event types ────────────────────────────────
export type UserInjectionEvent = z.infer<typeof userInjectionEventSchema>
export type PlanEditEvent = z.infer<typeof planEditEventSchema>
export type ToolCallRejectedEvent = z.infer<typeof toolCallRejectedEventSchema>
export type ForkPointEvent = z.infer<typeof forkPointEventSchema>

export type ScanEvent =
  | StageEvent
  | ProgressEvent
  | FindingEvent
  | ErrorEvent
  | DoneEvent
  | ThinkingEvent
  | ResponseEvent
  | MetaEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | CostEvent
  | ServerInfoEvent
  | FileReadEvent
  | FileWriteEvent
  | TerminalOutputEvent
  | PlanEvent
  | StopReasonEvent
  | UserInjectionEvent
  | PlanEditEvent
  | ToolCallRejectedEvent
  | ForkPointEvent

/** Returns true for events that must never be dropped from the buffer */
export function isHighPriorityEvent(event: ScanEvent): boolean {
  return (
    event.type === 'finding' ||
    event.type === 'error' ||
    event.type === 'done' ||
    event.type === 'stage' ||
    event.type === 'permission_request'
  )
}
