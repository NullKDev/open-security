import type { ScanOpts } from '../index'
import { readFileSync } from 'node:fs'

/** Supported stream output formats from CLI agents (legacy — ACP agents use SDK streaming) */
export type StreamFormat = 'claude-stream-json' | 'json-event-stream' | 'plain'

/** Transport kind used to route CLI agent scan invocations */
export type TransportKind = 'sdk' | 'http' | 'acp'

/** A selectable model option for a CLI agent */
export interface AgentModelOption {
  id: string
  label: string
}

/** Sentinel option meaning "use whatever the CLI is configured with — don't pass --model" */
export const DEFAULT_MODEL_OPTION: AgentModelOption = {
  id: 'default',
  label: 'Default (CLI config)',
}

/**
 * Definition for a CLI-based LLM agent that can be spawned as a child process.
 */
export interface AgentDef {
  id: string
  /** Human-readable display name */
  name?: string
  /** Binary name to locate on PATH */
  bin: string
  /** Arguments for capability probing (usually --version) */
  probeArgs: string[]
  /** Output format the agent produces on stdout (legacy — ACP agents use SDK streaming) */
  streamFormat: StreamFormat
  /** Transport kind that routes scan invocations for this agent */
  transport: TransportKind
  /** For ACP transport: args to start the agent in JSON-RPC 2.0 mode. Required when transport === 'acp'. */
  acpArgs?: string[]
  /** Environment variables to set when spawning (undefined = inherit) */
  env?: Record<string, string | undefined>
  /**
   * Statically-known models shown when the agent is unavailable or when
   * live discovery fails.
   */
  fallbackModels?: AgentModelOption[]
  /**
   * If set, run a CLI subcommand to discover available models dynamically.
   * Used for agents like opencode that expose `opencode models`.
   */
  listModels?: {
    args: string[]
    timeoutMs?: number
    parse: (stdout: string) => AgentModelOption[] | null
  }
  /** Build the CLI argument array for a scan invocation (legacy — ACP agents use acpArgs instead) */
  buildArgs: (prompt: string, opts: ScanOpts) => string[]
  /**
   * When true, the prompt is written to stdin (with `-` as the positional arg).
   * stdin must be opened as 'pipe'. Avoids ENAMETOOLONG on large prompts.
   */
  promptViaStdin?: boolean
}

function parseLineSeparatedModels(stdout: string): AgentModelOption[] | null {
  const ids = String(stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
  if (ids.length === 0) return null
  const seen = new Set<string>()
  const out: AgentModelOption[] = [DEFAULT_MODEL_OPTION]
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: id })
  }
  return out
}

export const AGENT_DEFS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    probeArgs: ['--version'],
    streamFormat: 'claude-stream-json',
    transport: 'sdk',
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
    buildArgs: (prompt, opts) => {
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
      ]
      if (opts.modelId && opts.modelId !== 'default') {
        args.push('--model', opts.modelId)
      }
      return args
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['acp'],
    promptViaStdin: false,
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (Anthropic)' },
      { id: 'openai/gpt-4o', label: 'GPT-4o (OpenAI)' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Google)' },
    ],
    listModels: {
      args: ['models'],
      timeoutMs: 3000,
      parse: parseLineSeparatedModels,
    },
    buildArgs: (_prompt, opts) => {
      const args = [
        'run',
        '--format', 'json',
        '--dangerously-skip-permissions',
        '--thinking',
      ]
      if (opts.modelId && opts.modelId !== 'default') {
        args.push('--model', opts.modelId)
      }
      return args
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['--acp'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'o3', label: 'O3' },
      { id: 'o4-mini', label: 'O4 Mini' },
    ],
    buildArgs: (prompt, opts) => {
      const args = ['exec', '--json', '--sandbox', 'workspace-write']
      if (opts.modelId && opts.modelId !== 'default') {
        args.push('--model', opts.modelId)
      }
      args.push('--', prompt)
      return args
    },
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['--acp'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    buildArgs: (prompt, opts) => {
      const args = ['-p', prompt, '--output-format', 'stream-json']
      if (opts.modelId && opts.modelId !== 'default') {
        args.push('--model', opts.modelId)
      }
      return args
    },
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['--acp'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    listModels: {
      args: ['models'],
      timeoutMs: 3000,
      parse: (stdout) => {
        const trimmed = String(stdout ?? '').trim()
        if (!trimmed || /no models available/i.test(trimmed)) return null
        return parseLineSeparatedModels(trimmed)
      },
    },
    buildArgs: (_prompt, _opts) => [],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['--acp'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'qwen-coder-plus', label: 'Qwen Coder Plus' },
    ],
    buildArgs: (prompt, _opts) => ['-p', prompt, '--output-format', 'json'],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    bin: 'npx',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['@github/copilot-language-server@latest', '--acp'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
    /** buildArgs is never called for ACP transport — exists only to satisfy AgentDef interface */
    buildArgs: () => {
      throw new Error('ACP transport should not call buildArgs')
    },
  },
  {
    id: 'auggie',
    name: 'Auggie',
    bin: 'npx',
    probeArgs: ['--version'],
    streamFormat: 'json-event-stream',
    transport: 'acp',
    acpArgs: ['@augmentcode/auggie@latest', '--acp'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    ],
    /** buildArgs is never called for ACP transport — exists only to satisfy AgentDef interface */
    buildArgs: () => {
      throw new Error('ACP transport should not call buildArgs')
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    bin: 'ollama',
    probeArgs: ['--version'],
    streamFormat: 'plain',
    transport: 'http',
    fallbackModels: [
      { id: 'llama3', label: 'Llama 3' },
      { id: 'codellama', label: 'Code Llama' },
      { id: 'deepseek-coder', label: 'DeepSeek Coder' },
    ],
    buildArgs: (prompt, opts) => ['run', opts.modelId ?? 'llama3', prompt],
  },
]

/** Look up an agent definition by its id */
export function getAgentDef(id: string): AgentDef | undefined {
  return AGENT_DEFS.find((a) => a.id === id)
}

/**
 * Load agent definitions, merging external config from the filesystem.
 *
 * Checks `process.env.ACP_AGENTS_CONFIG` for a path to a JSON file
 * containing an array of {@link AgentDef} objects. External agents with
 * the same `id` override hardcoded ones; new `id` values are appended.
 *
 * On any error (missing file, invalid JSON, malformed data), the
 * hardcoded {@link AGENT_DEFS} are returned unchanged — the system
 * degrades gracefully.
 *
 * @returns The merged agent definition array, with external definitions
 *          taking priority over built-in ones.
 */
export function loadExternalAgents(): AgentDef[] {
  const configPath = process.env.ACP_AGENTS_CONFIG
  if (!configPath) return AGENT_DEFS

  try {
    const raw = readFileSync(configPath, 'utf-8')
    if (!raw.trim()) return AGENT_DEFS

    const external = JSON.parse(raw) as AgentDef[]
    if (!Array.isArray(external) || external.length === 0) return AGENT_DEFS

    // Merge: external agents override/add to AGENT_DEFS
    const merged = new Map<string, AgentDef>()
    for (const def of AGENT_DEFS) {
      merged.set(def.id, def)
    }
    for (const def of external) {
      merged.set(def.id, def)
    }

    return Array.from(merged.values())
  } catch {
    return AGENT_DEFS
  }
}
