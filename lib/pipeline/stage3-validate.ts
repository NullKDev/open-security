import type { ScanEvent } from './events'
import type { ProviderClient, ScanOpts } from '@/lib/providers/index'
import type { NormalizedFinding } from '@/lib/scanners/types'

export interface ValidationResult {
  finding: NormalizedFinding
  passes: boolean
  rationale: string
  model: string
}

export interface Stage3Opts {
  scanId: string
  findings: NormalizedFinding[]
  provider: ProviderClient
  /** Source directory of the scanned repo — used as cwd for validation spawn */
  targetPath: string
  onEvent: (event: ScanEvent) => void
}

export interface Stage3Result {
  validated: ValidationResult[]
}

/**
 * Stage 3 — LLM Validation
 *
 * For each finding from stages 1-2, performs a second LLM call to validate
 * whether the finding is a true positive. Uses the same provider interface.
 *
 * Emits progress events as each finding is validated.
 * Does NOT throw — errors from the provider are emitted as error events.
 */
export async function runStage3Validate(opts: Stage3Opts): Promise<Stage3Result> {
  const { scanId, findings, provider, targetPath, onEvent } = opts

  onEvent({
    type: 'stage',
    stage: 'validate',
    message: `[${scanId}] Validating ${findings.length} findings`,
  })

  const validated: ValidationResult[] = []

  for (const finding of findings) {
    onEvent({
      type: 'progress',
      message: `Validating: ${finding.title} in ${finding.locationPath}`,
    })

    const result = await validateFinding(finding, provider, targetPath, onEvent)
    validated.push(result)
  }

  const truePositives = validated.filter((v) => v.passes).length
  onEvent({
    type: 'stage',
    stage: 'validate',
    message: `[${scanId}] Validation complete — ${truePositives}/${findings.length} true positives`,
  })

  return { validated }
}

async function validateFinding(
  finding: NormalizedFinding,
  provider: ProviderClient,
  targetPath: string,
  onEvent: (event: ScanEvent) => void,
): Promise<ValidationResult> {
  const prompt = buildValidationPrompt(finding)
  // Run in the scanned repo's source directory so the LLM can find
  // and read the files referenced in the finding's locationPath.
  const scanOpts: ScanOpts = {
    targetPath,
    promptOverride: prompt,
  }

  let responseText = ''

  try {
    for await (const evt of provider.scan(scanOpts)) {
      if (evt.type === 'progress') {
        responseText += evt.message
      } else if (evt.type === 'thinking') {
        // The LLM's validation response (JSON {passes, rationale}) arrives as
        // thinking events — the opencode parser classifies non-finding JSON
        // text as reasoning. Accumulate it so parseValidationResponse can
        // extract the actual verdict instead of defaulting to passes:true.
        responseText += evt.text
        onEvent({ type: 'thinking', text: evt.text, format: evt.format ?? 'plain' })
      } else if (evt.type === 'response') {
        // Response events carry the model's prose/analysis — accumulate
        // alongside thinking for validation parsing.
        responseText += evt.text
        onEvent({ type: 'response', text: evt.text, format: evt.format ?? 'plain' })
      }
    }
  } catch (err: unknown) {
    // Auth errors are fatal — propagate so the pipeline aborts cleanly
    if (isAuthError(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message: `Validation failed for ${finding.title}: ${message}` })
    return {
      finding,
      passes: false,
      rationale: `Validation error: ${message}`,
      model: provider.id,
    }
  }

  const parsed = parseValidationResponse(responseText)
  return {
    finding,
    passes: parsed.passes,
    rationale: parsed.rationale,
    model: provider.id,
  }
}

function isAuthError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const status = (err as Record<string, unknown>).statusCode
    return status === 401 || status === 403
  }
  return false
}

function buildValidationPrompt(finding: NormalizedFinding): string {
  return [
    'You are a security expert validating a potential vulnerability finding.',
    'Determine if this finding is a REAL vulnerability (true positive) or a MISTAKE (false positive).',
    '',
    `Finding: ${finding.title}`,
    `Description: ${finding.description}`,
    `Severity: ${finding.severity}`,
    `Location: ${finding.locationPath}:${finding.locationLineStart}`,
    `Detector: ${finding.detector}`,
    '',
    'Respond with a JSON object:',
    '{ "isVulnerability": true|false, "rationale": "brief explanation" }',
  ].join('\n')
}

interface ParsedValidation {
  passes: boolean
  rationale: string
}

function parseValidationResponse(text: string): ParsedValidation {
  // Provider returned nothing — spawn likely failed (ENOENT, crash, timeout)
  if (!text.trim()) {
    return { passes: false, rationale: 'Provider returned no response — validation skipped' }
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      // Support both old "passes" field and new "isVulnerability" field.
      // The old prompt used "passes" which was ambiguous (LLMs interpreted it
      // both as "code passes" and "finding passes"). The new prompt uses
      // "isVulnerability" which is unambiguous.
      const isVuln = typeof parsed.isVulnerability === 'boolean'
        ? parsed.isVulnerability
        : typeof parsed.passes === 'boolean'
          ? parsed.passes
          : null
      if (isVuln !== null) {
        return {
          passes: isVuln,
          rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided',
        }
      }
    }
  } catch {
    // Fall through to default
  }

  // Default: assume true positive if we can't parse
  return { passes: true, rationale: 'Could not parse validation response' }
}
