/**
 * project-map.ts — Pass 0: Project Intelligence
 *
 * Generates a ProjectMap via LLM call (or fallback from stack hints)
 * before domain-level scans in intermediate/paranoid modes.
 */
import { z } from 'zod'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '@/lib/db/schema'
import { setProjectMap } from '@/lib/repos/scans.repo'
import type { ProviderClient } from '@/lib/providers/index'
import type { StrategyContext } from './strategies/types'

type DB = BetterSQLite3Database<typeof schema>

// ─── Constants ──────────────────────────────────────────────────────────────

export const FILES_PER_DOMAIN = 40
export const MAX_PASS0_TREE_BYTES = 16 * 1024
export const MAX_PASS0_SNIPPETS_BYTES = 8 * 1024

// ─── Schema ─────────────────────────────────────────────────────────────────

export const ProjectMapSchema = z.object({
  stack: z.array(z.string()).max(20),
  frameworks: z.array(z.string()).max(20),
  entryPoints: z.array(z.string()).max(50),
  attackSurface: z.array(z.string()).max(50),
  domains: z.array(z.string()).min(1).max(7),
  relevantSkillIds: z.array(z.string()).max(20),
})

export type ProjectMap = z.infer<typeof ProjectMapSchema>

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the first balanced JSON object `{...}` from arbitrary text.
 * Returns the substring (including braces) or null if no balanced object found.
 */
export function extractFirstJsonObject(text: string): string | null {
  // Find the first opening brace
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (ch === '\\') {
      escape = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

// ─── Default Project Map ────────────────────────────────────────────────────

/** Default security domains ordered by risk impact */
const DEFAULT_DOMAINS = [
  'web',
  'cloud',
  'mobile',
  'db',
  'cicd',
  'supply-chain',
  'language',
] as const

/**
 * Fallback when LLM fails — derive a minimal ProjectMap from stage0 stack hints.
 * Intermediate: 3–4 domains, Paranoid: 5–7 domains.
 */
export function defaultProjectMapFromStack(
  stack: string[],
  variant: 'intermediate' | 'paranoid',
): ProjectMap {
  const count = variant === 'intermediate' ? 4 : 7
  const domains = DEFAULT_DOMAINS.slice(0, count)

  return {
    stack: [...stack],
    frameworks: [],
    entryPoints: [],
    attackSurface: domains.map((d) => d.replace(/-/g, ' ')),
    domains: [...domains],
    relevantSkillIds: [],
  }
}

// ─── Pass 0 Prompt ──────────────────────────────────────────────────────────

export interface Pass0PromptOpts {
  fileTree: string
  sampleSnippets: string
  stackHints: string[]
  variant: 'intermediate' | 'paranoid'
  injectedRules: string
}

export function buildPass0Prompt(opts: Pass0PromptOpts): string {
  const domainCount = opts.variant === 'intermediate' ? '3–4' : '5–7'

  const parts = [
    'You are a senior security architect. Read the file tree and code samples below. Produce ONE JSON object matching this schema:',
    '',
    '{',
    '  "stack":            string[],   // langs, runtimes, package managers',
    '  "frameworks":       string[],   // web framework, ORM, auth lib, etc.',
    '  "entryPoints":      string[],   // file paths that receive external input',
    '  "attackSurface":    string[],   // categories like "http-api", "file-upload", "shell-exec", "sql", "auth"',
    `  "domains":          string[],   // ${domainCount} security domains to investigate, ordered by risk`,
    '  "relevantSkillIds": string[]    // skill IDs from the registry below that apply to this project',
    '}',
  ]

  if (opts.injectedRules) {
    parts.push('', opts.injectedRules)
  }

  // Truncate file tree
  const tree = opts.fileTree.length > MAX_PASS0_TREE_BYTES
    ? opts.fileTree.slice(0, MAX_PASS0_TREE_BYTES) + '\n[...truncated]'
    : opts.fileTree

  // Truncate snippets
  const snippets = opts.sampleSnippets.length > MAX_PASS0_SNIPPETS_BYTES
    ? opts.sampleSnippets.slice(0, MAX_PASS0_SNIPPETS_BYTES) + '\n[...truncated]'
    : opts.sampleSnippets

  parts.push(
    '',
    '## File tree (truncated)',
    tree,
    '',
    '## Representative samples',
    snippets,
    '',
    '## Detected stack hints',
    opts.stackHints.join(', ') || '(none)',
    '',
    'Output ONLY the JSON object. No markdown fences, no commentary.',
  )

  return parts.join('\n')
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Generate a ProjectMap via LLM.
 * On first failure: retry once with stricter prompt.
 * On second failure or no provider: fall back to defaultProjectMapFromStack.
 */
export async function generateProjectMap(
  provider: ProviderClient | undefined,
  ctx: StrategyContext,
  variant: 'intermediate' | 'paranoid',
): Promise<ProjectMap> {
  if (!provider) {
    ctx.onEvent({
      type: 'progress',
      message: `[${ctx.scanId}] No LLM provider for Pass 0 — using default project map`,
    })
    return defaultProjectMapFromStack(ctx.stage0Stack, variant)
  }

  const injectedRules = '' // Resolved by caller; kept as no-op for now
  const prompt = buildPass0Prompt({
    fileTree: ctx.fileTree ?? '(file tree unavailable)',
    sampleSnippets: ctx.sampleSnippets ?? '(samples unavailable)',
    stackHints: ctx.stage0Stack,
    variant,
    injectedRules,
  })

  // Attempt 1
  const text1 = await collectProviderText(provider, ctx, prompt)
  const map1 = tryParseProjectMap(text1, ctx)
  if (map1) {
    ctx.onEvent({
      type: 'progress',
      message: `[${ctx.scanId}] Pass 0 complete — ${map1.domains.length} domains: ${map1.domains.join(', ')}`,
    })
    return map1
  }

  // Retry with stricter prompt
  ctx.onEvent({
    type: 'progress',
    message: `[${ctx.scanId}] Pass 0 JSON parse failed — retrying with stricter prompt`,
  })
  const retryPrompt = prompt + '\n\nYour previous response failed JSON parsing. Output a single valid JSON object and NOTHING else.'
  const text2 = await collectProviderText(provider, ctx, retryPrompt)
  const map2 = tryParseProjectMap(text2, ctx)
  if (map2) {
    ctx.onEvent({
      type: 'progress',
      message: `[${ctx.scanId}] Pass 0 retry succeeded — ${map2.domains.length} domains: ${map2.domains.join(', ')}`,
    })
    return map2
  }

  // Fallback
  ctx.onEvent({
    type: 'progress',
    message: `[${ctx.scanId}] Pass 0 failed twice — falling back to default project map`,
  })
  return defaultProjectMapFromStack(ctx.stage0Stack, variant)
}

/** Collect all text from a provider scan into a single string. */
async function collectProviderText(
  provider: ProviderClient,
  ctx: StrategyContext,
  prompt: string,
): Promise<string> {
  const parts: string[] = []
  for await (const event of provider.scan({
    targetPath: ctx.targetPath,
    promptOverride: prompt,
  })) {
    if (ctx.isAborted()) break
    if (event.type === 'thinking') {
      parts.push(event.text)
    } else if (event.type === 'progress') {
      parts.push(event.message)
    } else if (event.type === 'finding') {
      // Some providers emit findings as structured output — accumulate meaningful text
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { type: _t, ...rest } = event
      parts.push(JSON.stringify(rest))
    }
  }
  return parts.join('\n')
}

/** Try to extract and parse a ProjectMap from LLM text. Returns null on failure. */
function tryParseProjectMap(text: string, ctx: StrategyContext): ProjectMap | null {
  // Try ALL balanced JSON objects, not just the first one.
  // The LLM often emits reasoning fragments (via --thinking) that contain
  // small JSON snippets before the actual ProjectMap. We try each candidate
  // and return the first one that passes ProjectMapSchema validation.
  const candidates = extractAllJsonObjects(text)
  if (candidates.length === 0) {
    ctx.onEvent({
      type: 'progress',
      message: `[${ctx.scanId}] Pass 0: no JSON object found in LLM response`,
    })
    return null
  }

  for (const json of candidates) {
    try {
      const parsed = JSON.parse(json)
      return ProjectMapSchema.parse(parsed)
    } catch {
      // This candidate didn't validate — try the next one
    }
  }

  ctx.onEvent({
    type: 'progress',
    message: `[${ctx.scanId}] Pass 0: ${candidates.length} JSON candidate(s) found but none matched ProjectMap schema`,
  })
  return null
}

/**
 * Extract ALL balanced JSON objects from text, ordered by appearance.
 * Unlike extractFirstJsonObject which returns only the first one,
 * this collects every valid `{...}` pair so we can try them all.
 */
function extractAllJsonObjects(text: string): string[] {
  const results: string[] = []
  let i = 0

  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start === -1) break

    let depth = 0
    let inString = false
    let escape = false
    let found = false

    for (let j = start; j < text.length; j++) {
      const ch = text[j]

      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue

      if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = text.slice(start, j + 1)
          // Skip trivial fragments (less than 20 chars) — reasoning artifacts
          if (candidate.length >= 20) {
            results.push(candidate)
          }
          i = j + 1
          found = true
          break
        }
      }
    }
    if (!found) break
  }

  return results
}

// ─── Persistence ────────────────────────────────────────────────────────────

/**
 * Persist to <workspaceRoot>/projectMap.json AND scans.project_map column.
 */
export async function persistProjectMap(
  db: DB,
  scanId: string,
  workspaceRoot: string,
  map: ProjectMap,
): Promise<void> {
  // Write to filesystem
  try {
    const json = JSON.stringify(map, null, 2)
    writeFileSync(join(workspaceRoot, 'projectMap.json'), json, 'utf-8')
  } catch {
    // Best-effort — DB is the authoritative store
  }

  // Write to DB
  setProjectMap(db, scanId, JSON.stringify(map))
}

// ─── Domain → File Mapping ──────────────────────────────────────────────────

/** Common keyword patterns per domain keyword, used for file-matching heuristic. */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  auth: ['auth', 'login', 'signin', 'session', 'jwt', 'oauth', 'token', 'password', 'permission', 'role'],
  'input-validation': ['input', 'validate', 'sanitiz', 'escape', 'xss', 'csrf', 'form', 'query', 'param'],
  'data-access': ['sql', 'query', 'db', 'database', 'orm', 'repository', 'migrat', 'seed', 'prisma', 'drizzle'],
  'api-security': ['route', 'api', 'handler', 'middleware', 'cors', 'rate-limit', 'graphql', 'endpoint'],
  'secrets-management': ['secret', 'env', 'config', 'credential', 'key', 'token', '.env', 'vault'],
  'dependency-supply-chain': ['package', 'lock', 'import', 'require', 'vendor', 'mod', 'gem', 'cargo', 'pip', 'composer'],
  cryptography: ['crypt', 'hash', 'cipher', 'encrypt', 'decrypt', 'ssl', 'tls', 'cert', 'hmac'],
}

/**
 * Build the file list a given domain should target.
 * Uses keyword + path matching against entryPoints and attackSurface.
 * Capped at FILES_PER_DOMAIN.
 */
export function mapDomainToFiles(
  _domain: string,
  _projectMap: ProjectMap,
  _targetPath: string,
): string[] {
  // In the full implementation, this walks entryPoints/attackSurface and
  // matches file paths against domain keywords. For now, returns a
  // representative sample that the caller can use for scoped scanning.
  //
  // TODO: integrate with actual file tree from stage0
  return []
}
