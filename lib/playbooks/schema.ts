/**
 * lib/playbooks/schema.ts
 *
 * Zod schema and TypeScript type for playbook manifests.
 * Used by ManifestLoader to validate YAML playbook files.
 */
import { z } from 'zod'

/**
 * Zod schema for a playbook manifest (.obt-skill YAML file).
 * Validates both user-created and builtin playbooks.
 */
export const PlaybookManifestSchema = z.object({
  /** Unique playbook identifier (e.g. `find-ssrf`). */
  id: z.string().min(1),
  /** Human-readable playbook name. */
  name: z.string().min(1),
  /** Semantic version string (e.g. `1.0.0`). */
  version: z.string().min(1),
  /** Optional description shown in the playbook picker. */
  description: z.string().optional(),
  /** The prompt template string with `{{var}}` placeholders. */
  promptTemplate: z.string().min(1),
  /** Optional list of scanner names to scope (e.g. `['semgrep', 'gitleaks']`). */
  scannerScope: z.array(z.string()).optional(),
  /** Optional free-form parameters — stored as arbitrary key/value pairs. */
  parameters: z.record(z.unknown()).optional(),
  /** Source of the playbook: builtin playbooks shipped with OBT, or user-created. */
  source: z.enum(['builtin', 'user']),
  /** True if this is a first-party playbook shipped with OBT. */
  builtIn: z.boolean().optional(),
  /** True if the user has explicitly trusted this playbook to run. */
  trusted: z.boolean().optional(),
})

/** TypeScript type inferred from `PlaybookManifestSchema`. */
export type Playbook = z.infer<typeof PlaybookManifestSchema>
