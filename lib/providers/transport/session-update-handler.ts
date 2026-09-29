/**
 * Maps ACP SessionNotification updates to typed ProviderEvent objects.
 *
 * Handles the discriminated union on `update.sessionUpdate` from
 * `@agentclientprotocol/sdk` and emits corresponding internal events.
 *
 * Field names match the Zod schemas in lib/pipeline/events.ts
 * and the ProviderEvent types in lib/providers/index.ts.
 *
 * @module session-update-handler
 */
import type { SessionNotification, ToolKind } from '@agentclientprotocol/sdk'

// ---- Event type definitions ----

/** Emitted for each text chunk in the agent's response. */
export interface ResponseChunkEvent {
  type: 'response'
  text: string
  format?: 'markdown' | 'plain'
  /** ACP messageId (UNSTABLE) — group chunks with the same ID into one message. */
  messageId?: string
}

/** Emitted for each chunk of agent internal reasoning. */
export interface ThinkingChunkEvent {
  type: 'thinking'
  text: string
  format?: 'markdown' | 'plain'
  /** ACP messageId (UNSTABLE) — group chunks with the same ID into one block. */
  messageId?: string
}

/** Re-export the SDK's canonical ToolKind type. */
export type { ToolKind }

/** A file location referenced by a tool call. */
export interface ToolLocation {
  path: string
  line?: number
}

/** Emitted when the agent starts a tool call. */
export interface ToolCallEvent {
  type: 'tool_call'
  toolCallId: string
  /** Human-readable title from the ACP `title` field. */
  toolName: string
  /** ACP `kind` field — use for icon / rendering strategy. */
  kind?: ToolKind
  /** Files the tool is operating on. */
  locations?: ToolLocation[]
  input: unknown
}

/** Emitted when a tool call completes or fails — carries the result. */
export interface ToolResultEvent {
  type: 'tool_result'
  toolCallId: string
  output: unknown
  isError: boolean
  /** File diffs extracted from ACP ToolCallContent diff entries. */
  diffs?: Array<{ path: string; newText: string; oldText?: string | null }>
}

/** A single step within an execution plan. */
export interface PlanStep {
  title: string
  status: 'pending' | 'in_progress' | 'done' | 'error'
}

/** Emitted when the agent shares its execution plan. */
export interface PlanEvent {
  type: 'plan'
  steps: PlanStep[]
}

/** Emitted with cumulative cost/token information. */
export interface CostEvent {
  type: 'cost'
  inputTokens: number
  outputTokens: number
  costUsd?: number
  /** Total context window size in tokens (ACP UsageUpdate.size). */
  contextSize?: number
  /** Tokens currently in use in the context window (ACP UsageUpdate.used). */
  contextUsed?: number
}

/** Emitted with agent identity and capability information. */
export interface ServerInfoEvent {
  type: 'server_info'
  agentId: string
  agentVersion?: string
  capabilities?: unknown
}

/** Union of all events emitted by SessionUpdateHandler. */
export type SessionUpdateHandlerEvent =
  | ResponseChunkEvent
  | ThinkingChunkEvent
  | ToolCallEvent
  | ToolResultEvent
  | PlanEvent
  | CostEvent
  | ServerInfoEvent

// ---- Handler ----

/**
 * Routes ACP `SessionNotification` updates to typed internal `ProviderEvent`s.
 *
 * Uses proper discriminated union checks on `update.sessionUpdate` — no regex.
 * Unknown or unhandled notification types are silently ignored (empty array).
 */
export class SessionUpdateHandler {
  /**
   * Dispatches a SessionNotification into zero or more typed events.
   *
   * @param notification - The raw ACP session update notification.
   * @returns Array of typed events (empty for unknown types).
   */
  dispatch(notification: SessionNotification): SessionUpdateHandlerEvent[] {
    const { update, sessionId } = notification

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return [this.mapContentChunk(update, 'response')]

      case 'agent_thought_chunk':
        return [this.mapContentChunk(update, 'thinking')]

      case 'tool_call':
        return [this.mapToolCall(update)]

      case 'tool_call_update':
        return [this.mapToolResult(update)]

      case 'plan':
        return [this.mapPlan(update)]

      case 'usage_update':
        return [this.mapCost(update)]

      case 'session_info_update':
        return [this.mapServerInfo(update, sessionId)]

      default:
        // user_message_chunk, available_commands_update, current_mode_update,
        // config_option_update — not relevant for the scan pipeline.
        return []
    }
  }

  private mapContentChunk(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' }>,
    type: 'response' | 'thinking',
  ): ResponseChunkEvent | ThinkingChunkEvent {
    const block = update.content
    const text = block.type === 'text' ? block.text : ''
    // messageId (UNSTABLE) — present when the agent sends it, used for grouping
    const messageId = (update as { messageId?: string }).messageId
    return { type, text, format: 'markdown', ...(messageId ? { messageId } : {}) }
  }

  private mapToolCall(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'tool_call' }>,
  ): ToolCallEvent {
    return {
      type: 'tool_call',
      toolCallId: update.toolCallId,
      toolName: update.title,
      kind: update.kind as ToolKind | undefined,
      locations: update.locations?.map((l) => ({
        path: l.path,
        ...(l.line != null ? { line: l.line } : {}),
      })),
      input: update.rawInput ?? null,
    }
  }

  private mapToolResult(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'tool_call_update' }>,
  ): ToolResultEvent {
    const diffs = update.content
      ?.filter((c): c is { type: 'diff'; path: string; newText: string; oldText?: string | null } => c.type === 'diff')
      .map((d) => ({ path: d.path, newText: d.newText, oldText: d.oldText }))

    return {
      type: 'tool_result',
      toolCallId: update.toolCallId,
      output: update.rawOutput ?? null,
      isError: update.status === 'failed',
      ...(diffs && diffs.length > 0 ? { diffs } : {}),
    }
  }

  private mapPlan(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'plan' }>,
  ): PlanEvent {
    return {
      type: 'plan',
      steps: update.entries.map((entry) => ({
        status: entry.status as PlanStep['status'],
        title: entry.content,
      })),
    }
  }

  private mapCost(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'usage_update' }>,
  ): CostEvent {
    return {
      type: 'cost',
      inputTokens: update.used ?? 0,
      outputTokens: 0,
      costUsd: update.cost?.currency === 'USD' ? update.cost.amount : undefined,
      contextSize: update.size,
      contextUsed: update.used,
    }
  }

  private mapServerInfo(
    update: Extract<SessionNotification['update'], { sessionUpdate: 'session_info_update' }>,
    sessionId: string,
  ): ServerInfoEvent {
    return {
      type: 'server_info',
      agentId: sessionId,
      agentVersion: update.title ?? undefined,
    }
  }
}
