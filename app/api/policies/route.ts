/**
 * PUT /api/policies
 *
 * Validate and save a policies.yaml document.
 * Parses the YAML, validates against PolicyFileSchema, then writes to
 * {OBT_ROOT}/policies.yaml using workspace path helpers.
 *
 * Body: { yaml: string }
 * Response: { ok: true }
 * Errors: 400 (invalid body, parse error, or schema violation), 500 (write error)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { OBT_ROOT } from '@/lib/config/store'
import { PolicyFileSchema } from '@/lib/policies/rule-loader'

const BodySchema = z.object({
  yaml: z.string().min(1, 'yaml must not be empty'),
})

/**
 * PUT /api/policies
 *
 * Accepts a YAML string, validates it against PolicyFileSchema,
 * and writes it to {OBT_ROOT}/policies.yaml.
 *
 * @param request - HTTP request with `{ yaml: string }` body
 */
export async function PUT(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const bodyParsed = BodySchema.safeParse(body)
  if (!bodyParsed.success) {
    return fail('INVALID_INPUT', bodyParsed.error.issues.map((e) => e.message).join('; '))
  }

  const { yaml: yamlStr } = bodyParsed.data

  // ── Parse YAML ─────────────────────────────────────────────────────────────
  let parsed: unknown
  try {
    parsed = yaml.load(yamlStr)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INVALID_INPUT', `YAML parse error: ${message}`)
  }

  // ── Validate schema ────────────────────────────────────────────────────────
  const validated = PolicyFileSchema.safeParse(parsed)
  if (!validated.success) {
    const details = validated.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    return fail('INVALID_INPUT', `Policy schema error: ${details}`)
  }

  // ── Write to disk ──────────────────────────────────────────────────────────
  try {
    const policiesPath = path.join(OBT_ROOT, 'policies.yaml')
    fs.mkdirSync(path.dirname(policiesPath), { recursive: true })
    fs.writeFileSync(policiesPath, yamlStr, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', `Failed to write policies: ${message}`)
  }

  return ok({ ok: true })
}
