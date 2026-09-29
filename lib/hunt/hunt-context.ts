/**
 * lib/hunt/hunt-context.ts
 *
 * CVE hunt context type and prompt builder.
 * Loads the appropriate template for the CVE class and interpolates variables.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CveClass } from '@/lib/advisories/cve-class'
import { interpolate } from '@/lib/templates/interpolate'

/** Context data required to build a CVE hunt prompt. */
export interface HuntContext {
  /** CVE or GHSA identifier. */
  cveId: string
  /** Exploitation class determined by classifyAdvisory(). */
  cveClass: CveClass
  /** One-line summary from the advisory. */
  summary?: string
  /** Full advisory details. */
  details?: string
  /** URL to a public proof-of-concept, or null if not available. */
  pocUrl?: string | null
  /** File or directory path in the target repo to focus the hunt. */
  targetPath: string
  /** Primary package name from the advisory. */
  packageName?: string
}

const TEMPLATES_DIR = join(__dirname, 'prompt-templates')

/**
 * Loads the Markdown template for the given CVE class.
 * Template files are in `lib/hunt/prompt-templates/<class>.md`.
 */
function loadTemplate(cveClass: CveClass): string {
  const templatePath = join(TEMPLATES_DIR, `${cveClass}.md`)
  return readFileSync(templatePath, 'utf-8')
}

/**
 * Builds a hunt analysis prompt from a `HuntContext`.
 *
 * Loads the class-specific template from `lib/hunt/prompt-templates/` and
 * substitutes `{{var}}` placeholders with values from the context.
 * The `{{pocUrl}}` placeholder is replaced with a formatted reference line
 * when `pocUrl` is present, or removed when it is `null` / `undefined`.
 *
 * @param ctx - The hunt context containing CVE metadata and target information.
 * @returns The fully interpolated prompt string.
 */
export function buildHuntPrompt(ctx: HuntContext): string {
  const template = loadTemplate(ctx.cveClass)

  // Build the vars map for interpolation
  const vars: Record<string, string> = {
    cveId: ctx.cveId,
    summary: ctx.summary ?? '',
    details: ctx.details ?? '',
    targetPath: ctx.targetPath,
    packageName: ctx.packageName ?? '',
  }

  // Handle pocUrl: replace with a formatted line or remove the placeholder
  const pocLine =
    ctx.pocUrl != null ? `**PoC reference**: ${ctx.pocUrl}` : ''
  vars['pocUrl'] = pocLine

  return interpolate(template, vars)
}
