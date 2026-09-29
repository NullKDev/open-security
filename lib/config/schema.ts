import { z } from 'zod'

export const StageId = z.enum(['llm-scan', 'validate', 'filter', 'patch'])
export type StageId = z.infer<typeof StageId>

// Use Partial record: object with optional string values per stage
const modelsSchema = z.object({
  'llm-scan': z.string().optional(),
  'validate': z.string().optional(),
  'filter': z.string().optional(),
  'patch': z.string().optional(),
}).default({})

/**
 * v1.0 feature flag schema — controls which v1.0 subsystems are active.
 * All flags default to true (opt-out model).
 */
const featuresSchema = z.object({
  /** Enable policy engine (suppress/severity floor/assign rules) */
  policies: z.boolean().default(true),
  /** Enable collaboration features (comments, assignments, export panels) */
  collaboration: z.boolean().default(true),
  /** Enable consensus scoring (multi-scanner agreement) */
  consensus: z.boolean().default(true),
}).default({ policies: true, collaboration: true, consensus: true })

/**
 * v1.0 integration metadata schema — non-sensitive config only.
 * Sensitive credentials (tokens, keys) are stored in the encrypted secret-store.
 */
const integrationsSchema = z.object({
  jira: z.object({
    baseUrl: z.string().optional(),
    projectKey: z.string().optional(),
    email: z.string().optional(),
  }).default({}),
  slack: z.object({
    webhookUrl: z.string().optional(),
  }).default({}),
  githubCodeScanning: z.object({
    owner: z.string().optional(),
    repo: z.string().optional(),
  }).default({}),
  socket: z.object({}).default({}),
}).default({ jira: {}, slack: {}, githubCodeScanning: {}, socket: {} })

export const ObtConfig = z.object({
  models: modelsSchema,
  providers: z.object({
    anthropicKey: z.string().optional(),
    openaiKey: z.string().optional(),
    googleKey: z.string().optional(),
    /** v0.2: GitHub personal access token for PR comments and apply-fix */
    githubToken: z.string().optional(),
  }).default({}),
  theme: z.enum(['light', 'dark']).default('dark'),
  workerMemoryMb: z.number().int().min(256).max(8192).default(2048),
  stage2Concurrency: z.number().int().min(1).max(16).default(4),
  /** v1.0: Feature flags for v1.0 subsystems */
  features: featuresSchema,
  /** v1.0: Integration metadata (non-sensitive fields only) */
  integrations: integrationsSchema,
})
export type ObtConfig = z.infer<typeof ObtConfig>

export const defaultConfig: ObtConfig = ObtConfig.parse({})
