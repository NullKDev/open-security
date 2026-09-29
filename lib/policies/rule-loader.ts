/**
 * lib/policies/rule-loader.ts
 *
 * v1.0 policy rule loader for the new structured policy engine.
 * Distinct from `lib/policies/loader.ts` (legacy FP filter loader).
 *
 * Reads `.obt/policies.yaml` from both workspace and home directory.
 * Workspace rules override global rules for overlapping rule IDs.
 * Expired rules are loaded but NOT filtered here — that is the engine's responsibility.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import * as yaml from 'js-yaml'
import { z } from 'zod'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PolicyMatchSchema = z.object({
  path: z.string().optional(),
  severity: z.string().optional(),
  tag: z.string().optional(),
  detector: z.string().optional(),
})

const PolicyDecisionSchema = z.object({
  suppress: z.boolean().optional(),
  severity: z.string().optional(),
  assignee: z.string().optional(),
  /** ISO date string — if in the past, the rule is expired */
  expiresAt: z.string().optional(),
})

export const PolicyRuleSchema = z.object({
  id: z.string(),
  type: z.enum(['suppress', 'severity_floor', 'assign', 'ignore']),
  match: PolicyMatchSchema,
  decision: PolicyDecisionSchema,
})

export const PolicyFileSchema = z.object({
  rules: z.array(PolicyRuleSchema),
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyRule = z.infer<typeof PolicyRuleSchema>
export type PolicyFile = z.infer<typeof PolicyFileSchema>

// ─── Loader ───────────────────────────────────────────────────────────────────

const POLICY_FILENAME = '.obt/policies.yaml'

/**
 * Options for loading policy rules.
 */
export interface LoadPolicyRulesOpts {
  /** Root of the workspace (project directory) */
  workspaceRoot: string
  /** Home directory (defaults to os.homedir()) — used to locate global policy */
  homeDir?: string
}

/**
 * Load and merge policy rules from global (~/.obt/policies.yaml) and
 * workspace (.obt/policies.yaml) YAML files.
 *
 * Merge strategy: global rules first; workspace rules override by rule ID.
 * Missing files are silently ignored.
 * Invalid YAML or schema violations throw a ZodError.
 *
 * @param opts - workspace root and optional home directory override
 * @returns Merged array of PolicyRule objects (workspace overrides global)
 * @throws ZodError if a policy file contains invalid content
 */
export async function loadPolicyRules(opts: LoadPolicyRulesOpts): Promise<PolicyRule[]> {
  const { workspaceRoot, homeDir = homedir() } = opts

  const globalPath = path.join(homeDir, POLICY_FILENAME)
  const workspacePath = path.join(workspaceRoot, POLICY_FILENAME)

  const globalRules = readPolicyFile(globalPath)
  const workspaceRules = readPolicyFile(workspacePath)

  // Merge: build a map keyed by rule ID, global first, workspace overrides
  const merged = new Map<string, PolicyRule>()

  for (const rule of globalRules) {
    merged.set(rule.id, rule)
  }

  for (const rule of workspaceRules) {
    merged.set(rule.id, rule)
  }

  return Array.from(merged.values())
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Read and Zod-validate a policy YAML file.
 * Returns an empty array if the file does not exist.
 *
 * @throws ZodError if the file content is invalid
 */
function readPolicyFile(filePath: string): PolicyRule[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(raw)
  const validated = PolicyFileSchema.parse(parsed)
  return validated.rules
}
