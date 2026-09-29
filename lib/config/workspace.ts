/**
 * workspace.ts — Canonical filesystem paths for the .obt workspace
 *
 * Every project and scan gets its own isolated directory tree.
 * All path construction goes through these helpers — never hardcode .obt paths.
 *
 * Layout:
 *   .obt/
 *     db.sqlite
 *     config.json
 *     projects/
 *       {projectId}/
 *         scans/
 *           {scanId}/
 *             source/    ← cloned / copied source code
 *             reports/   ← generated reports (json, md, sarif, csv)
 *             pocs/      ← proof-of-concept scripts for findings
 */
import * as path from 'node:path'
import * as fs from 'node:fs'
import { OBT_ROOT } from './store'

export function projectDir(projectId: string, root = OBT_ROOT): string {
  return path.join(root, 'projects', projectId)
}

export function scanDir(projectId: string, scanId: string, root = OBT_ROOT): string {
  return path.join(root, 'projects', projectId, 'scans', scanId)
}

export function scanSourceDir(projectId: string, scanId: string, root = OBT_ROOT): string {
  return path.join(scanDir(projectId, scanId, root), 'source')
}

export function scanReportsDir(projectId: string, scanId: string, root = OBT_ROOT): string {
  return path.join(scanDir(projectId, scanId, root), 'reports')
}

export function scanPocsDir(projectId: string, scanId: string, root = OBT_ROOT): string {
  return path.join(scanDir(projectId, scanId, root), 'pocs')
}

/** Creates the full directory tree for a new scan (source + reports + pocs). */
export function ensureScanDirs(projectId: string, scanId: string, root = OBT_ROOT): void {
  const base = scanDir(projectId, scanId, root)
  fs.mkdirSync(path.join(base, 'source'), { recursive: true })
  fs.mkdirSync(path.join(base, 'reports'), { recursive: true })
  fs.mkdirSync(path.join(base, 'pocs'), { recursive: true })
}

// ─── v0.3: Playbook directories ──────────────────────────────────

/**
 * Returns the directory for builtin playbooks shipped with OBT.
 * Points to `lib/playbooks/builtins/` relative to the project root.
 */
export function builtinPlaybooksDir(): string {
  return path.join(__dirname, '..', 'playbooks', 'builtins')
}

/**
 * Returns the user-level playbook directory under the `.obt` root.
 * User-created playbooks are stored here and persist across projects.
 *
 * @param root - The `.obt` root directory (defaults to `OBT_ROOT`).
 */
export function userPlaybooksDir(root = OBT_ROOT): string {
  return path.join(root, 'playbooks')
}

/**
 * Returns the workspace-local playbook directory within a project.
 * Workspace playbooks are co-located with the project and take highest priority.
 *
 * @param workspaceRoot - The root directory of the workspace being scanned.
 */
export function workspacePlaybooksDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.obt-skills')
}
