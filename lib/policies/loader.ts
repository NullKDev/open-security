import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { z } from 'zod'

// ─── Schemas ────────────────────────────────────────────────────────────────

const SeverityPolicySchema = z.object({
  thresholds: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  cvss_map: z.record(z.string(), z.string()),
})

const ConfidencePolicySchema = z.object({
  minimum_report: z.number(),
  minimum_validate: z.number(),
  minimum_patch: z.number(),
  auto_fp_below: z.number(),
})

const FpFilterRuleSchema = z.object({
  id: z.string(),
  match_path: z.string(),
  action: z.string(),
})

const FpFilterPolicySchema = z.object({
  rules: z.array(FpFilterRuleSchema),
})

// ─── Types ──────────────────────────────────────────────────────────────────

export type SeverityPolicy = z.infer<typeof SeverityPolicySchema>
export type ConfidencePolicy = z.infer<typeof ConfidencePolicySchema>
export type FpFilterPolicy = z.infer<typeof FpFilterPolicySchema>

export type PolicyName = 'severity' | 'confidence' | 'fp-filter'
export type Policy = SeverityPolicy | ConfidencePolicy | FpFilterPolicy

// ─── Schema Registry ────────────────────────────────────────────────────────

const SCHEMAS: Record<PolicyName, z.ZodType<Policy>> = {
  severity: SeverityPolicySchema,
  confidence: ConfidencePolicySchema,
  'fp-filter': FpFilterPolicySchema,
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new Map<PolicyName, Policy>()

/** Reset the module-level cache (used in tests). */
export function __resetCache(): void {
  cache.clear()
}

// ─── Loader ─────────────────────────────────────────────────────────────────

const POLICIES_DIR = path.resolve(process.cwd(), 'policies')

/**
 * Load and validate a named policy from `policies/{name}.yaml`.
 * Results are cached in memory after the first load.
 *
 * @throws {Error} if the file cannot be read
 * @throws {ZodError} if the parsed content does not match the expected schema
 */
export async function loadPolicy(name: PolicyName): Promise<Policy> {
  const cached = cache.get(name)
  if (cached !== undefined) {
    return cached
  }

  const filePath = path.join(POLICIES_DIR, `${name}.yaml`)
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(raw)

  const schema = SCHEMAS[name]
  const validated = schema.parse(parsed)

  cache.set(name, validated)
  return validated
}
