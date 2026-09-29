import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface CompactRule {
  skillId: string
  triggers: string[]
  source: string
  body: string
}

const MAX_RULES_BYTES = 4096

/** Module-level cache: rootDir → parsed rules */
const _cache = new Map<string, CompactRule[]>()

/**
 * Parse the Compact Rules section of a skill-registry markdown string.
 * Exported for testing.
 */
export function parseSkillRegistry(markdown: string): CompactRule[] {
  if (!markdown.trim()) return []

  // Find the "## Compact Rules" section — everything after it until next ## heading
  const sectionIdx = markdown.search(/^##\s+Compact Rules/m)
  if (sectionIdx === -1) {
    // Fallback: try to parse ### blocks directly from the entire document
    return parseRuleBlocks(markdown)
  }

  // Extract from after the "## Compact Rules" header to the next ## heading (or end of file)
  const afterHeader = markdown.slice(sectionIdx)
  const nextSectionIdx = afterHeader.search(/\n##\s+[^#]/)
  const sectionContent = nextSectionIdx === -1
    ? afterHeader
    : afterHeader.slice(0, nextSectionIdx)

  return parseRuleBlocks(sectionContent)
}

function parseRuleBlocks(text: string): CompactRule[] {
  const rules: CompactRule[] = []
  // Split on ### headings
  const blocks = text.split(/^###\s+/m).filter((b) => b.trim())

  for (const block of blocks) {
    const lines = block.split('\n')
    const skillId = lines[0]?.trim()
    if (!skillId) continue

    let triggers: string[] = []
    let source = ''
    const bodyLines: string[] = []
    let pastMeta = false

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const triggersMatch = line.match(/^\*\*Triggers\*\*\s*:\s*(.+)/)
      const sourceMatch = line.match(/^\*\*Source\*\*\s*:\s*(.+)/)

      if (triggersMatch) {
        triggers = triggersMatch[1].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      } else if (sourceMatch) {
        source = sourceMatch[1].trim()
        pastMeta = true
      } else if (pastMeta || (!triggersMatch && !sourceMatch && i > 2)) {
        bodyLines.push(line)
      }
    }

    if (skillId && triggers.length > 0) {
      rules.push({
        skillId,
        triggers,
        source,
        body: bodyLines.join('\n').trim(),
      })
    }
  }

  return rules
}

/**
 * Read .atl/skill-registry.md from the given project root.
 * Cached for the process lifetime per rootDir.
 * Returns empty array if the file is missing — does NOT throw.
 */
export function loadCompactRules(rootDir?: string): CompactRule[] {
  const root = rootDir ?? process.cwd()
  if (_cache.has(root)) return _cache.get(root)!

  const filePath = join(root, '.atl', 'skill-registry.md')
  if (!existsSync(filePath)) {
    // File missing is expected in many environments — warn but don't throw
    process.stderr.write(`[skills/registry] Skill registry not found at ${filePath} — continuing without skill rules\n`)
    _cache.set(root, [])
    return []
  }

  try {
    const markdown = readFileSync(filePath, 'utf-8')
    const rules = parseSkillRegistry(markdown)
    _cache.set(root, rules)
    return rules
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[skills/registry] Failed to read skill registry: ${msg}\n`)
    _cache.set(root, [])
    return []
  }
}

/**
 * Returns concatenated rule bodies whose triggers match any token in `stack`.
 * Wrapped in "## Security Skills\n..." header. Capped at MAX_RULES_BYTES.
 * Returns empty string if registry is missing or no matches.
 *
 * Accepts optional `registryMarkdown` for testing without file I/O.
 */
export function resolveRulesForStack(stack: string[], registryMarkdown?: string): string {
  const rules = registryMarkdown ? parseSkillRegistry(registryMarkdown) : loadCompactRules()
  const stackLower = stack.map((s) => s.toLowerCase())

  const matched = rules.filter((rule) =>
    rule.triggers.some((trigger) =>
      stackLower.some((token) => token.includes(trigger) || trigger.includes(token)),
    ),
  )

  if (matched.length === 0) return ''

  const combined = matched.map((r) => r.body).join('\n\n')
  const header = '## Security Skills\n'
  const capped = (header + combined).slice(0, MAX_RULES_BYTES + header.length + 10)

  // Trim to MAX_RULES_BYTES after header
  if (capped.length > MAX_RULES_BYTES) {
    return capped.slice(0, MAX_RULES_BYTES)
  }
  return capped
}

/**
 * Returns rules matching the domain keyword first; falls back to stack matches.
 * Same cap and header as resolveRulesForStack.
 */
export function resolveRulesForDomain(domain: string, stack: string[], registryMarkdown?: string): string {
  const rules = registryMarkdown ? parseSkillRegistry(registryMarkdown) : loadCompactRules()
  const domainLower = domain.toLowerCase()
  const stackLower = stack.map((s) => s.toLowerCase())

  // First try domain-specific match
  const domainMatched = rules.filter((rule) =>
    rule.triggers.some((t) => domainLower.includes(t) || t.includes(domainLower)),
  )

  const candidates = domainMatched.length > 0
    ? domainMatched
    : rules.filter((rule) =>
        rule.triggers.some((trigger) =>
          stackLower.some((token) => token.includes(trigger) || trigger.includes(token)),
        ),
      )

  if (candidates.length === 0) return ''

  const combined = candidates.map((r) => r.body).join('\n\n')
  const header = '## Security Skills\n'
  const full = header + combined
  return full.length > MAX_RULES_BYTES ? full.slice(0, MAX_RULES_BYTES) : full
}
