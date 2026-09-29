import { getDb } from '@/lib/db/client'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getFindingById, updateFinding } from '@/lib/repos/findings.repo'
import { createProviderForStage } from '@/lib/providers/stage-routing'
import type { ProviderClient, ScanOpts } from '@/lib/providers/index'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: fid } = await params
  const db = getDb()
  const finding = getFindingById(db, fid)

  if (!finding) {
    return fail('NOT_FOUND', `Finding ${fid} not found`)
  }

  const provider = createProviderForStage('patch')
  if (!provider) {
    return fail('INVALID_INPUT', 'No patch provider configured. Configure one in Settings.')
  }

  const prompt = buildPatchPrompt(finding)
  const scanOpts: ScanOpts = {
    targetPath: '.',
    promptOverride: prompt,
  }

  let responseText = ''

  try {
    for await (const evt of provider.scan(scanOpts)) {
      if (evt.type === 'progress') responseText += evt.message
      else if (evt.type === 'thinking') responseText += evt.text
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', `Patch generation failed: ${message}`)
  }

  const parsed = parsePatchResponse(responseText)

  updateFinding(db, fid, {
    patchDiff: parsed.summary,
    patchExplanation: parsed.approach,
    patchGeneratedAt: new Date().toISOString(),
  })

  return ok({
    findingId: fid,
    summary: parsed.summary,
    approach: parsed.approach,
  })
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

function buildPatchPrompt(finding: ReturnType<typeof getFindingById>): string {
  return [
    'You are a senior security engineer. Review this vulnerability and suggest a fix.',
    'Do NOT apply changes. Do NOT output full diffs. Be concise but thorough.',
    '',
    `Title: ${finding!.title}`,
    `Description: ${finding!.description}`,
    `Location: ${finding!.locationPath}:${finding!.locationLineStart}`,
    `Severity: ${finding!.severity}`,
    '',
    'Respond with a JSON object:',
    '{',
    '  "summary": "2-3 paragraphs explaining the root cause, the concrete risk, and exactly what needs to change to fix it. Be specific enough that a developer can implement the fix without guessing.",',
    '  "approach": "one-line tag: parameterize-queries | validate-input | escape-output | pin-dependencies | add-auth-check | limit-size | use-prepared-stmt | etc."',
    '}',
  ].join('\n')
}
