import { readConfig } from '@/lib/config/store'
import type { StageId } from '@/lib/config/schema'
import { loadExternalAgents } from './cli/agents'
import type { AgentDef } from './cli/agents'
import { findOnPath } from './cli/resolve'
import { createApiModel } from './api/factory'
import type { ApiProviderId } from './api/factory'
import { wrapStreamText } from './api/stream'
import type { ProviderClient, ProviderEvent, ScanOpts } from './index'
import { resolveRulesForStack, resolveRulesForDomain } from '@/lib/skills/registry'
import { ollamaHttpScan } from './transport/http'
import { claudeSdkScan } from './sdk/claude'
import { acpScan } from './transport/acp'

/**
 * Parsed representation of a model string from config.
 *
 * CLI format:
 *   `cli:<agentId>`               — agent default model
 *   `cli:<agentId>:<modelId>`     — specific model (e.g. "cli:claude:claude-sonnet-4-5")
 *
 * API format:
 *   `api:<providerId>:<modelId>`  — e.g. "api:anthropic:claude-sonnet-4"
 */
export type ResolvedModel =
  | { kind: 'cli'; agentId: string; modelId: string | null }
  | { kind: 'api'; providerId: ApiProviderId; modelId: string }

/**
 * Parse a model configuration string into a structured representation.
 *
 * Returns `undefined` for unrecognized or malformed strings.
 */
export function resolveModelString(raw: string): ResolvedModel | undefined {
  if (!raw) return undefined

  const parts = raw.split(':')
  if (parts.length < 2) return undefined

  const kind = parts[0]

  if (kind === 'cli') {
    const agentId = parts[1]
    if (!agentId) return undefined
    const modelId = parts.slice(2).join(':') || null
    return { kind: 'cli', agentId, modelId }
  }

  if (kind === 'api') {
    if (parts.length < 3) return undefined
    const providerId = parts[1] as ApiProviderId
    const modelId = parts.slice(2).join(':')
    if (!validApiProvider(providerId) || !modelId) return undefined
    return { kind: 'api', providerId, modelId }
  }

  return undefined
}

function validApiProvider(id: string): id is ApiProviderId {
  return ['anthropic', 'openai', 'google', 'ollama'].includes(id)
}

/**
 * Create a ProviderClient for the configured model on a given pipeline stage.
 *
 * Reads `config.models.{stage}` from the config store. If no model is
 * configured for the stage (or the string is invalid), returns `undefined`.
 */
export function createProviderForStage(
  stage: StageId,
): ProviderClient | undefined {
  const config = readConfig()
  const raw = config.models[stage]
  if (!raw) return undefined

  const resolved = resolveModelString(raw)
  if (!resolved) return undefined

  if (resolved.kind === 'cli') {
    return createCliProvider(resolved.agentId, resolved.modelId)
  }

  return createApiSdkProvider(resolved.providerId, resolved.modelId)
}

/** Build a CLI-based ProviderClient for the given agent and optional model */
function createCliProvider(
  agentId: string,
  modelId: string | null,
): ProviderClient | undefined {
  const agents = loadExternalAgents()
  const def = agents.find((a) => a.id === agentId)
  if (!def) return undefined

  // Verify the binary is actually on PATH before creating the client.
  // Prevents "spawn ENOENT" errors at scan time when a provider was
  // configured on a different machine (e.g., probing found it locally
  // but the scan runs on a server where the binary doesn't exist).
  if (!findOnPath(def.bin)) {
    console.warn(`[providers] ${def.bin} not found on PATH — skipping cli:${agentId}`)
    return undefined
  }

  return makeCliClient(def, modelId)
}

/** Build an API-SDK-based ProviderClient for the given provider + model */
function createApiSdkProvider(
  providerId: ApiProviderId,
  modelId: string,
): ProviderClient {
  const model = createApiModel(providerId, modelId)
  return {
    id: `api:${providerId}:${modelId}`,
    capability: {
      stream: true,
      tools: true,
      jsonMode: true,
      transportKind: 'api-sdk' as const,
      thinkingSupport: ['anthropic', 'google'].includes(providerId),
    },
    async *scan(opts: ScanOpts): AsyncIterable<ProviderEvent> {
      const { streamText } = await import('ai')
      const prompt = opts.promptOverride ?? buildScanPrompt({ stack: [], userPrompt: null })
      const result = streamText({ model, prompt })
      for await (const evt of wrapStreamText(result)) {
        yield evt
      }
    },
  }
}

/** Options for building a security scan prompt. */
export interface BuildScanPromptOpts {
  /** Detected stack hints (languages, runtimes, frameworks) */
  stack: string[]
  /** User-supplied free-form prompt appended to the security prompt */
  userPrompt?: string | null
  /** Domain label for domain-scoped scans (e.g. 'web', 'mobile', 'cloud') */
  domain?: string
  /** List of files to scope the scan to (paths relative to targetPath) */
  files?: string[]
  /** When true, requests inline fix suggestions for each finding — paranoid mode */
  includeFixSuggestions?: boolean
  /** Optional registry markdown for testing without file I/O */
  registryMarkdown?: string
  /**
   * Detector hints to inject.
   * Intermediate: one-line summaries.
   * Paranoid: full detection instructions from SKILL.md.
   */
  detectorHints?: string
  /** Scan depth — 'paranoid' enables deeper search instructions */
  scanDepth?: 'standard' | 'paranoid'
}

/** Build the default security scan prompt */
export function buildScanPrompt(opts: BuildScanPromptOpts): string {
  const rules = opts.registryMarkdown
    ? (opts.domain
        ? resolveRulesForDomain(opts.domain, opts.stack, opts.registryMarkdown)
        : resolveRulesForStack(opts.stack, opts.registryMarkdown))
    : (opts.domain
        ? resolveRulesForDomain(opts.domain, opts.stack)
        : resolveRulesForStack(opts.stack))

  const parts: string[] = []

  // Security Skills section — injected first for prominence
  if (rules) {
    parts.push(rules, '')
  }

  const isParanoid = opts.scanDepth === 'paranoid' || opts.includeFixSuggestions

  // Domain-specific header when a domain is set
  if (opts.domain) {
    parts.push(
      `You are an expert offensive security engineer performing a **${isParanoid ? 'deep adversarial' : 'focused'}** audit of the **${opts.domain}** domain.`,
      '',
    )
    if (isParanoid) {
      parts.push(
        '**Paranoid mode**: Act as a skilled attacker who has full access to the source. Be skeptical of every assumption. Look beyond surface patterns — trace data flows, follow function calls across files, inspect configuration files, build scripts, and test code. Do NOT skip something because it "looks safe". Confirm or deny every suspicion by reading the actual code.',
        '',
      )
    }
    if (opts.detectorHints) {
      parts.push(
        '## Vulnerability Checklist for This Domain',
        opts.detectorHints,
        '',
      )
    }
  } else {
    parts.push(
      `You are an expert offensive security engineer. Analyze the entire codebase for vulnerabilities. Stack: ${opts.stack.join(', ') || 'unknown'}.`,
      '',
      '## Domains to audit:',
      '- Web: SQLi, XSS, SSRF, path traversal, command injection, deserialization, auth bypass, prototype pollution, mass assignment, NoSQL injection, security misconfig',
      '- Cloud: hardcoded credentials, overly permissive IAM, exposed storage, Terraform/K8s/Docker misconfig',
      '- Mobile: hardcoded creds, insecure storage, cleartext traffic, WebView config, SSL pinning bypass, root detection bypass, exported components, AndroidManifest flags',
      '- DB: ORM injection, unencrypted connections, weak auth, migrations with unsafe operations',
      '- CI/CD: workflow injection, hardcoded secrets in pipelines, unprotected triggers, self-hosted runner risks',
      '- Supply chain: dependency confusion, unpinned deps, malicious hooks in package scripts',
      '- Repo/Git: secrets in history, suspicious commits, author impersonation, large hidden diffs',
      '- Language-specific: Python pickle/eval, JS child_process, Go unsafe, Rust unsafe, Java deserialization, C buffer overflow',
      '- Shell: argument injection, eval injection, env poisoning',
      '- Social engineering: fake credentials, phishing URLs, impersonation in comments/messages',
      '',
    )
  }

  // Scoped file list
  if (opts.files && opts.files.length > 0) {
    parts.push(
      '## Files to inspect',
      opts.files.slice(0, 40).join('\n'),
      '',
    )
  }

  if (isParanoid) {
    parts.push(
      '## Required methodology',
      '1. Use your file reading tools to open and read the actual source files — do NOT guess from filenames.',
      '2. Trace data from external inputs (HTTP params, env vars, file reads, IPC) through the call graph.',
      '3. For each vulnerability category in the checklist: actively search for it. If unsure, open more files.',
      '4. Check configuration files, build scripts (build.gradle, pom.xml, Makefile, package.json scripts), and CI/CD pipelines.',
      '5. Check git history files if available (.git/logs, CHANGELOG, commit messages).',
      '6. Report ALL findings including medium/low — do not self-filter. Err on the side of reporting.',
      '',
    )
  } else {
    parts.push(
      'Use your file reading tools to read actual source code. Do not guess — open the files.',
      '',
    )
  }

  // User-supplied prompt
  if (opts.userPrompt) {
    parts.push(opts.userPrompt, '')
  }

  // Output format instructions
  parts.push(
    'When you find a vulnerability, output EXACTLY one JSON object per line:',
    '{"title":"<short name>","description":"<what is wrong and why it matters>","severity":"<critical|high|medium|low|info>","location":"<file:line>","detector":"llm"}',
  )

  if (opts.includeFixSuggestions) {
    parts.push(
      '',
      'For each finding also add a "fix" field with a concise unified diff patch showing the minimal fix.',
    )
  }

  parts.push(
    '',
    'Output ONLY those JSON lines — no preamble, no commentary, no markdown fences.',
    'If you find nothing in this domain, output nothing.',
  )

  return parts.join('\n')
}

/**
 * Build a ProviderClient for a CLI agent, dispatching to the correct transport
 * based on the agent's TransportKind.
 *
 * Transport routing:
 *   sdk        → @anthropic-ai/claude-agent-sdk (claude)
 *   http       → streaming fetch to localhost:11434 (ollama)
 *   acp        → JSON-RPC 2.0 over stdio (gemini, codex)
 *   acp → ACP SDK transport (opencode, gemini, qwen, codex, copilot, auggie, cursor-agent)
 */
function makeCliClient(def: AgentDef, modelId: string | null): ProviderClient {
  /** Whether the provider supports native extended thinking */
  const thinkingSupport = def.id === 'claude' || def.id === 'codex' || def.id === 'opencode'

  return {
    id: `cli:${def.id}`,
    capability: {
      stream: true,
      tools: def.id === 'claude' || def.id === 'codex',
      jsonMode: true,
      transportKind: def.transport,
      thinkingSupport,
    },

    scan(opts: ScanOpts): AsyncIterable<ProviderEvent> {
      const prompt = opts.promptOverride ?? buildScanPrompt({ stack: [], userPrompt: null })
      const mergedOpts: ScanOpts = {
        ...opts,
        modelId: modelId && modelId !== 'default' ? modelId : (opts.modelId ?? undefined),
      }

      switch (def.transport) {
        case 'sdk':
          return claudeSdkScan(mergedOpts.modelId ?? null, prompt, mergedOpts)
        case 'http':
          return ollamaHttpScan(mergedOpts.modelId ?? 'llama3', prompt)
        case 'acp':
          return acpScan(def, prompt, mergedOpts)
      }
    },
  }
}
