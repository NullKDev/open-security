import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertUnder } from '@/lib/security/path-guard'

/**
 * Copies a local directory into the workspace.
 *
 * Both source and destination must be under the accepted root path.
 * Uses fs.cp for recursive copy. Rejects system paths like /etc.
 *
 * @param sourcePath - Local directory to copy
 * @param destPath - Destination within the workspace
 * @param acceptedRoot - Root under which both source and dest must reside
 * @returns The resolved destination path
 */
export async function copyLocalSource(
  sourcePath: string,
  destPath: string,
  acceptedRoot: string,
): Promise<string> {
  const resolvedRoot = path.resolve(acceptedRoot)

  // Reject copying system paths (like /etc, /proc, /sys, etc.)
  const resolvedSource = path.resolve(sourcePath)
  if (resolvedSource === '/' ||
      resolvedSource.startsWith('/etc') ||
      resolvedSource.startsWith('/proc') ||
      resolvedSource.startsWith('/sys') ||
      resolvedSource.startsWith('/dev')) {
    throw new Error(`Source path is outside accepted root: ${sourcePath}`)
  }

  // Source must be under acceptedRoot
  assertUnder(resolvedRoot, resolvedSource)

  // Dest must be under acceptedRoot
  assertUnder(resolvedRoot, destPath)

  // Verify source exists and is a directory
  const stat = fs.statSync(resolvedSource)
  if (!stat.isDirectory()) {
    throw new Error(`Source is not a directory: ${resolvedSource}`)
  }

  const resolvedDest = path.resolve(destPath)

  // Create parent directory of destination
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true })

  // Recursive copy
  await fs.promises.cp(resolvedSource, resolvedDest, { recursive: true })

  return resolvedDest
}
