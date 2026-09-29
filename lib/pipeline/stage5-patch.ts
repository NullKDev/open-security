import type { ScanEvent } from './events'
import type { ProviderClient, ScanOpts } from '@/lib/providers/index'
import type { NormalizedFinding } from '@/lib/scanners/types'

export interface PatchResult {
  finding: NormalizedFinding
  patchDiff: string | null
  patchExplanation: string | null
}

export interface Stage5Opts {
  scanId: string
  findings: NormalizedFinding[]
  provider: ProviderClient
  /** Source directory of the scanned repo — used as cwd for patch spawn */
  targetPath: string
  onEvent: (event: ScanEvent) => void
}

export interface Stage5Result {
  patches: PatchResult[]
}

/**
 * Stage 5 — Patch Synthesis
 *
 * For each validated finding, invokes the LLM to synthesize a remediation patch.
 * Parses the patch diff and explanation from the provider response.
 *
 * Emits progress events per finding. Does NOT throw.
 */
export async function runStage5Patch(opts: Stage5Opts): Promise<Stage5Result> {
  const { scanId, findings, provider, targetPath, onEvent } = opts

  onEvent({
    type: 'stage',
    stage: 'patch',
    message: `[${scanId}] Synthesizing patches for ${findings.length} findings`,
  })

  const patches: PatchResult[] = []

  for (const finding of findings) {
    onEvent({
      type: 'progress',
      message: `Synthesizing patch for: ${finding.title}`,
    })

    const patch = await synthesizePatch(finding, provider, targetPath, onEvent)
    patches.push(patch)
  }

  const withPatch = patches.filter((p) => p.patchDiff !== null).length
  onEvent({
    type: 'stage',
    stage: 'patch',
    message: `[${scanId}] Patch synthesis complete — ${withPatch}/${findings.length} patches generated`,
  })

  return { patches }
}

async function synthesizePatch(
  finding: NormalizedFinding,
  provider: ProviderClient,
  targetPath: string,
  onEvent: (event: ScanEvent) => void,
): Promise<PatchResult> {
  const prompt = buildPatchPrompt(finding)
  // Run in the scanned repo's source directory so the LLM can read the
  // files referenced in the finding and generate accurate diffs.
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
        // Accumulate thinking text — the LLM's patch response arrives as
        // thinking events when the opencode parser classifies it as reasoning.
        responseText += evt.text
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message: `Patch synthesis failed for ${finding.title}: ${message}` })
    return { finding, patchDiff: null, patchExplanation: null }
  }

  const parsed = parsePatchResponse(responseText)
  return {
    finding,
    patchDiff: parsed.summary ?? null,
    patchExplanation: parsed.approach ?? null,
  }
}

function buildPatchPrompt(finding: NormalizedFinding): string {
  return [
    'You are a senior security engineer. Review this vulnerability and suggest a fix.',
    'Do NOT apply changes. Do NOT output full diffs. Be concise but thorough.',
    '',
    `Title: ${finding.title}`,
    `Description: ${finding.description}`,
    `Location: ${finding.locationPath}:${finding.locationLineStart}`,
    `Severity: ${finding.severity}`,
    '',
    'Respond with a JSON object:',
    '{',
    '  "summary": "2-3 paragraphs explaining the root cause, the concrete risk, and exactly what needs to change to fix it. Be specific enough that a developer can implement the fix without guessing.",',
    '  "approach": "one-line tag: parameterize-queries | validate-input | escape-output | pin-dependencies | add-auth-check | limit-size | use-prepared-stmt | etc."',
    '}',
  ].join('\n')
}

interface ParsedPatch {
  summary: string | null
  approach: string | null
}

function parsePatchResponse(text: string): ParsedPatch {
  const empty = { summary: null, approach: null }
  if (!text.trim()) return empty

  try {
    const jsonMatch = text.match(/\{[\s\S]+?\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : null,
        approach: typeof parsed.approach === 'string' ? parsed.approach : null,
      }
    }
  } catch { /* fall through */ }
  return empty
}
