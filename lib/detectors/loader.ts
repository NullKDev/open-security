import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import type { DetectorMeta } from './types'

// ─── Schema ──────────────────────────────────────────────────────────────────

const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical'])

const DetectorMetaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  stages: z.array(z.string()).optional(),
  severity: SeveritySchema,
  description: z.string(),
  classical_prepass: z.string().optional(),
  classical_hint: z.string().optional(),
})

// ─── Root ────────────────────────────────────────────────────────────────────

const DETECTORS_DIR = path.resolve(process.cwd(), 'detectors')

/**
 * Parse YAML frontmatter from a Markdown file.
 * Frontmatter is delimited by `---` markers at the start of the file.
 */
function parseFrontmatter(content: string): unknown {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return null
  return yaml.load(trimmed.slice(3, end).trim())
}

/**
 * Extract the markdown body after the frontmatter.
 * Returns empty string if there is no body.
 */
function extractBody(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return ''
  return trimmed.slice(end + 4).trimStart()
}

/**
 * Extract only the "## Detection Prompt" section from a SKILL.md body.
 * Falls back to the entire body if the section is not found.
 * Capped at 3 000 chars to avoid inflating the LLM context.
 */
export function extractDetectionPrompt(body: string): string {
  const MAX = 3000
  const idx = body.search(/^##\s+Detection Prompt/m)
  if (idx === -1) {
    return body.slice(0, MAX)
  }
  // Find the end of this section (next ## heading or EOF)
  const after = body.slice(idx)
  const next = after.search(/\n##\s+[^#]/)
  const section = next === -1 ? after : after.slice(0, next)
  // Strip the heading line itself and code fences, keep instructions
  return section
    .replace(/^##\s+Detection Prompt\s*\n/m, '')
    .replace(/```[a-z]*\n/g, '')
    .replace(/```\s*\n?/g, '')
    .trim()
    .slice(0, MAX)
}

/**
 * Load a detector's metadata from a SKILL.md file.
 * Supports both flat structure (`detectors/{id}/SKILL.md`) and
 * domain-grouped structure (`detectors/{domain}/{id}/SKILL.md`).
 */
export async function loadDetector(id: string): Promise<DetectorMeta> {
  // Try domain-grouped first
  const domains = listDomains()
  for (const domain of domains) {
    const skillPath = path.join(DETECTORS_DIR, domain, id, 'SKILL.md')
    if (fs.existsSync(skillPath)) {
      return readDetectorFile(skillPath, id).meta
    }
  }

  // Legacy flat structure
  const flatPath = path.join(DETECTORS_DIR, id, 'SKILL.md')
  if (fs.existsSync(flatPath)) {
    return readDetectorFile(flatPath, id).meta
  }

  throw new Error(`Detector not found: ${id}`)
}

function readDetectorFile(skillPath: string, id: string): { meta: DetectorMeta; detectionPrompt: string } {
  const content = fs.readFileSync(skillPath, 'utf-8')
  const frontmatter = parseFrontmatter(content)
  if (frontmatter === null) {
    throw new Error(`Detector ${id} SKILL.md has no YAML frontmatter`)
  }
  const meta = DetectorMetaSchema.parse(frontmatter)
  const body = extractBody(content)
  const detectionPrompt = extractDetectionPrompt(body)
  return { meta, detectionPrompt }
}

/**
 * List all available detector domain directories.
 */
function listDomains(): string[] {
  try {
    return fs.readdirSync(DETECTORS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

/**
 * Discover all detectors across all domains.
 * Returns an array of { domain, id, meta } for every SKILL.md found.
 */
export interface DetectorEntry {
  domain: string
  id: string
  meta: DetectorMeta
  /** Full detection instructions from SKILL.md body (capped at 3 000 chars). */
  detectionPrompt: string
}

export function listAllDetectors(): DetectorEntry[] {
  const results: DetectorEntry[] = []
  const domains = listDomains()

  for (const domain of domains) {
    const domainDir = path.join(DETECTORS_DIR, domain)
    try {
      const entries = fs.readdirSync(domainDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillPath = path.join(domainDir, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillPath)) continue
        try {
          const { meta, detectionPrompt } = readDetectorFile(skillPath, entry.name)
          results.push({ domain, id: entry.name, meta, detectionPrompt })
        } catch {
          // Skip detectors with invalid frontmatter
        }
      }
    } catch {
      // Skip unreadable domains
    }
  }

  // Legacy: also scan flat detectors at root level
  try {
    const rootEntries = fs.readdirSync(DETECTORS_DIR, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue
      if (domains.includes(entry.name)) continue // already scanned as domain
      const skillPath = path.join(DETECTORS_DIR, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillPath)) continue
      try {
        const { meta, detectionPrompt } = readDetectorFile(skillPath, entry.name)
        results.push({ domain: '_root', id: entry.name, meta, detectionPrompt })
      } catch {
        // Skip
      }
    }
  } catch {
    // Skip
  }

  return results
}
