/**
 * Provider abstraction layer — unified interface for CLI spawn and API SDK providers.
 *
 * Every LLM provider (claude CLI, codex, gemini, opencode, Anthropic API, OpenAI API, etc.)
 * implements this interface so the scan pipeline can consume any backend transparently.
 */
export interface ScanOpts {
  /** Absolute path to the project/repo being scanned */
  targetPath: string

  /** Custom prompt to inject before the detector prompt */
  promptOverride?: string

  /** Provider-specific model identifier (e.g. "claude-sonnet-4-5-20250929") */
  modelId?: string

  /**
   * Permission mode for ACP scans.
   * - `auto` (default): Auto-approve all permission requests synchronously
   * - `interactive`: Emit permission_request SSE events, await user POST
   */
  permissionMode?: 'auto' | 'interactive'
}

/** A single event emitted during a provider scan */
export type ProviderEvent =
  | ProgressEvent
  | FindingEvent
  | ErrorEvent
  | DoneEvent
  | StopReasonEvent
  | ThinkingEvent
  | ResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | CostEvent
  | ServerInfoEvent
  | FileReadEvent
  | FileWriteEvent
  | TerminalOutputEvent
  | PlanEvent

/** Incremental progress — emitted for each text chunk or status update from the LLM */
export interface ProgressEvent {
  type: 'progress'
  message: string
  /** Approximate completion percentage (0–100, optional) */
  pct?: number
}

/** A security finding emitted by the LLM during the scan */
export interface FindingEvent {
  type: 'finding'
  title: string
  description: string
  /** Which detector rule triggered this finding */
  detector?: string
  /** Severity label (critical, high, medium, low, info) */
  severity?: string
  /** File path where the finding was detected */
  location?: string
}

/** An error encountered during the provider scan */
export interface ErrorEvent {
  type: 'error'
  message: string
  /** Raw error payload for debugging (redacted in production logs) */
  raw?: unknown
}

/** Signals that the provider scan has completed */
export interface DoneEvent {
  type: 'done'
}

/** Why the agent stopped processing the turn (ACP StopReason). */
export interface StopReasonEvent {
  type: 'stop_reason'
  /** ACP StopReason: end_turn | max_tokens | max_turn_requests | refusal | cancelled */
  reason: string
}

/** Extended thinking text from the model (Claude extended thinking / o1-style reasoning) */
export interface ThinkingEvent {
  type: 'thinking'
  text: string
  /** Format of the thinking text. Structured providers (opencode, claude) emit 'markdown'. Plain text providers emit 'plain'. Defaults to 'plain' when absent. */
  format?: 'markdown' | 'plain'
}

/** Model prose/analysis — what the LLM "says" (NOT its internal reasoning). */
export interface ResponseEvent {
  type: 'response'
  text: string
  /** Format hint. Markdown when structured content (headers, code blocks, lists). Defaults to 'plain'. */
  format?: 'markdown' | 'plain'
}

/** A tool invocation by the agent */
export interface ToolCallEvent {
  type: 'tool_call'
  toolName: string
  toolCallId: string
  input: unknown
}

/** The result of a tool invocation */
export interface ToolResultEvent {
  type: 'tool_result'
  toolCallId: string
  output: unknown
  isError: boolean
  /** File diffs produced by the tool (ACP ToolCallContent diff type). */
  diffs?: Array<{ path: string; newText: string; oldText?: string | null }>
}

/** A permission request from the agent requiring user approval */
export interface PermissionRequestEvent {
  type: 'permission_request'
  requestId: string
  toolName: string
  input: unknown
  timeoutMs: number
}

/** Token usage and cost information for the current turn */
export interface CostEvent {
  type: 'cost'
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd?: number
  /** Total context window size in tokens (ACP UsageUpdate.size). */
  contextSize?: number
  /** Tokens currently in use in the context window (ACP UsageUpdate.used). */
  contextUsed?: number
}

/** Agent identity and capability metadata emitted on connect */
export interface ServerInfoEvent {
  type: 'server_info'
  agentId: string
  agentVersion?: string
  capabilities?: unknown
}

/** The agent read a file */
export interface FileReadEvent {
  type: 'file_read'
  path: string
  preview?: string
}

/** The agent wrote a file */
export interface FileWriteEvent {
  type: 'file_write'
  path: string
  preview?: string
}

/** Terminal output from a command executed by the agent */
export interface TerminalOutputEvent {
  type: 'terminal_output'
  command?: string
  output: string
  exitCode?: number
}

/** A plan with ordered steps and their current status */
export interface PlanEvent {
  type: 'plan'
  steps: Array<{
    title: string
    status: 'pending' | 'in_progress' | 'done' | 'error'
  }>
}

/**
 * Represents a configured LLM provider that can execute security scans.
 *
 * Implementations exist for CLI-based agents (e.g. claude, codex, gemini, opencode)
 * and API-based SDKs (e.g. Anthropic, OpenAI, Google, Ollama).
 */
export interface ProviderClient {
  /** Unique provider identifier (e.g. "cli:claude", "api:anthropic") */
  id: string

  /** Capabilities advertised by this provider */
  capability: {
    /** Supports streaming responses */
    stream: boolean
    /** Supports tool/function calling */
    tools: boolean
    /** Supports structured JSON output mode */
    jsonMode: boolean
    /** Transport mechanism used by this provider */
    transportKind: 'sdk' | 'http' | 'acp' | 'api-sdk'
    /** Whether the provider supports native extended thinking */
    thinkingSupport: boolean
  }

  /**
   * Execute a security scan and yield events as they arrive.
   *
   * The async iterator produces zero or more ProviderEvents followed by exactly one
   * DoneEvent. If an unrecoverable error occurs, the iterator yields an ErrorEvent
   * and terminates (no DoneEvent).
   */
  scan(opts: ScanOpts): AsyncIterable<ProviderEvent>
}
