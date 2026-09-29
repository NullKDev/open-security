/**
 * lib/scanners/sarif.ts
 *
 * SARIF 2.1.0 ingester.
 *
 * Parses a SARIF JSON document and converts results to NormalizedFinding[].
 *
 * Design constraints:
 * - Hard cap at 10,000 findings per import (OOM prevention)
 * - Zod-validate the SARIF envelope before processing
 * - Map SARIF level to internal severity: error→high, warning→medium, note→low, (none|missing)→medium
 * - detector = 'sarif-import:{toolName}'
 *
 * Note: stream-json is not in package.json. This implementation uses synchronous
 * JSON parsing — for >50k findings, add stream-json to dependencies.
 */

import { z } from 'zod'
import type { NormalizedFinding, Severity } from './types'

/** Hard cap on findings per import */
const MAX_FINDINGS = 10_000

// ─── Zod schema for SARIF envelope validation ────────────────────────────────

const SarifRegionSchema = z.object({
  startLine: z.number().int().positive().optional(),
  startColumn: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).passthrough()

const SarifArtifactLocationSchema = z.object({
  uri: z.string().optional(),
  uriBaseId: z.string().optional(),
}).passthrough()

const SarifLocationSchema = z.object({
  physicalLocation: z.object({
    artifactLocation: SarifArtifactLocationSchema.optional(),
    region: SarifRegionSchema.optional(),
  }).passthrough().optional(),
}).passthrough()

const SarifResultSchema = z.object({
  ruleId: z.string().optional(),
  level: z.enum(['none', 'note', 'warning', 'error']).optional(),
  message: z.object({ text: z.string() }).passthrough().optional(),
  locations: z.array(SarifLocationSchema).optional(),
  partialFingerprints: z.record(z.string()).optional(),
}).passthrough()

const SarifRunSchema = z.object({
  tool: z.object({
    driver: z.object({
      name: z.string(),
      version: z.string().optional(),
    }).passthrough(),
  }).passthrough(),
  results: z.array(SarifResultSchema),
}).passthrough()

const SarifLogSchema = z.object({
  version: z.literal('2.1.0'),
  runs: z.array(SarifRunSchema).min(1),
}).passthrough()

/** Result of ingesting a SARIF document */
export interface SarifIngestResult {
  findings: NormalizedFinding[]
  /** True if the 10k cap was hit and results were truncated */
  capped: boolean
  /** Name of the tool that produced the SARIF */
  toolName: string
}

/**
 * Error thrown when the SARIF input fails schema validation.
 */
export class SarifIngestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SarifIngestError'
  }
}

/**
 * Map SARIF level to internal severity enum.
 */
function levelToSeverity(level: string | undefined): Severity {
  switch (level) {
    case 'error': return 'high'
    case 'warning': return 'medium'
    case 'note': return 'low'
    default: return 'medium'
  }
}

/**
 * Ingest a SARIF 2.1.0 document and return normalized findings.
 *
 * Validates the SARIF envelope via Zod. Throws {@link SarifIngestError} for
 * malformed input. Enforces a hard cap of 10,000 findings per import.
 *
 * @param raw - Parsed SARIF JSON (or any value — validation will reject non-SARIF)
 * @returns Normalized findings + metadata
 * @throws SarifIngestError if the input is not valid SARIF 2.1.0
 */
export function ingestSarif(raw: unknown): SarifIngestResult {
  // Validate envelope
  const parseResult = SarifLogSchema.safeParse(raw)
  if (!parseResult.success) {
    // Zod 4: error is { name, message } — no .errors array
    const errMsg =
      typeof parseResult.error === 'object' && parseResult.error !== null && 'message' in parseResult.error
        ? String((parseResult.error as { message: unknown }).message)
        : 'validation failed'
    throw new SarifIngestError(`Invalid SARIF 2.1.0 document: ${errMsg}`)
  }

  const sarif = parseResult.data
  const findings: NormalizedFinding[] = []
  let capped = false
  let toolName = 'unknown'

  for (const run of sarif.runs) {
    const driver = run.tool.driver
    toolName = driver.name
    const detector = `sarif-import:${driver.name}`

    for (const result of run.results) {
      if (findings.length >= MAX_FINDINGS) {
        capped = true
        break
      }

      // Extract location
      const location = result.locations?.[0]?.physicalLocation
      const uri = location?.artifactLocation?.uri ?? ''
      const startLine = location?.region?.startLine ?? 1

      const severity = levelToSeverity(result.level)
      const title = result.ruleId ?? result.message?.text ?? 'SARIF finding'
      const description = result.message?.text ?? title

      findings.push({
        title,
        description,
        severity,
        locationPath: uri,
        locationLineStart: startLine,
        detector,
        tags: result.ruleId ? [result.ruleId] : undefined,
      })
    }

    if (capped) break
  }

  return { findings, capped, toolName }
}
