/**
 * lib/playbooks/manifest-loader.ts
 *
 * Discovers and loads playbook manifest files from the filesystem.
 * Supports builtin, user, and workspace playbook directories.
 *
 * Uses the `yaml` package (not `js-yaml`) for safe parsing without alias expansion.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PlaybookManifestSchema, type Playbook } from './schema'
import {
  builtinPlaybooksDir,
  userPlaybooksDir,
  workspacePlaybooksDir,
} from '@/lib/config/workspace'

/**
 * Loads and validates a single playbook manifest file.
 * Returns `null` if the file cannot be parsed or fails schema validation.
 *
 * @param filePath - Absolute path to the `.obt-skill` YAML file.
 * @returns The validated `Playbook` or `null` on error.
 */
export function loadPlaybookFile(filePath: string): Playbook | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    // parse() from the `yaml` package does not expand aliases by default
    const parsed = parseYaml(raw) as unknown
    return PlaybookManifestSchema.parse(parsed)
  } catch {
    return null
  }
}

/**
 * Scans a directory for `.obt-skill` files and returns all valid playbooks.
 * Invalid files are silently skipped.
 *
 * @param dir - Absolute path to the directory to scan.
 * @returns Array of validated playbooks found in this directory.
 */
function loadFromDir(dir: string): Playbook[] {
  if (!existsSync(dir)) return []

  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }

  const result: Playbook[] = []
  for (const file of files) {
    if (extname(file) === '.obt-skill') {
      const playbook = loadPlaybookFile(join(dir, file))
      if (playbook !== null) result.push(playbook)
    }
  }
  return result
}

/**
 * Discovers all available playbooks by scanning three directories in priority order:
 * 1. Workspace-local playbooks (`<workspaceRoot>/.obt-skills/`)
 * 2. User playbooks (`~/.obt/playbooks/`)
 * 3. Builtin playbooks (shipped with OBT)
 *
 * Later-priority playbooks are included only if their `id` is not already taken
 * by a higher-priority one (workspace > user > builtin).
 *
 * @param workspaceRoot - The root directory of the workspace being scanned.
 * @returns Array of deduplicated `Playbook` instances.
 */
export async function discoverPlaybooks(workspaceRoot: string): Promise<Playbook[]> {
  const seenIds = new Set<string>()
  const result: Playbook[] = []

  const dirs = [
    workspacePlaybooksDir(workspaceRoot),
    userPlaybooksDir(),
    builtinPlaybooksDir(),
  ]

  for (const dir of dirs) {
    const playbooks = loadFromDir(dir)
    for (const playbook of playbooks) {
      if (!seenIds.has(playbook.id)) {
        seenIds.add(playbook.id)
        result.push(playbook)
      }
    }
  }

  return result
}
