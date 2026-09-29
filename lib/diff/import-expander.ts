/**
 * lib/diff/import-expander.ts
 *
 * 1-hop import expansion for diff scans.
 *
 * Given a list of changed file paths, finds all files in the target repo that
 * import from those files using ripgrep (rg) with a grep fallback.
 *
 * The expansion is intentionally shallow (1-hop only) to keep diff scans fast.
 * Anything deeper would pull in too many files and defeat the performance budget.
 */

import * as cp from 'node:child_process'
import path from 'node:path'

/** Source file extensions to include in expansion results */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])

/** Paths to exclude from expansion results */
const EXCLUDE_PATTERNS = ['node_modules', '.git', 'dist', '.next', 'coverage']

/**
 * Filter out non-source files and excluded paths from a list of file paths.
 */
function filterSourceFiles(files: string[]): string[] {
  return files.filter((f) => {
    const ext = path.extname(f)
    if (!SOURCE_EXTENSIONS.has(ext)) return false
    const normalized = f.replace(/\\/g, '/')
    return !EXCLUDE_PATTERNS.some((ex) => normalized.includes(ex))
  })
}

/**
 * Wraps cp.execFile as a promise. Exported for testability.
 */
function execAsync(
  bin: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.execFile(bin, args, { cwd }, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(typeof stdout === 'string' ? stdout : stdout.toString())
      }
    })
  })
}

/**
 * Search for files importing `filePath` in `repoPath` using ripgrep (rg).
 */
async function searchWithRg(filePath: string, repoPath: string): Promise<string[]> {
  const stem = path.basename(filePath).replace(/\.[^.]+$/, '')
  const pattern = `["'].*${stem}["']`
  try {
    const stdout = await execAsync(
      'rg',
      ['--files-with-matches', '--glob', '*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}', pattern, '.'],
      repoPath,
    )
    return stdout.split('\n').filter(Boolean)
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException & { exitCode?: number }
    // exit code 1 means "no matches" — not a true error for rg
    if (nodeErr.code === 1 || nodeErr.exitCode === 1) {
      return []
    }
    throw err
  }
}

/**
 * Search for files importing `filePath` using grep -r (fallback when rg is absent).
 */
async function searchWithGrep(filePath: string, repoPath: string): Promise<string[]> {
  const stem = path.basename(filePath).replace(/\.[^.]+$/, '')
  try {
    const stdout = await execAsync(
      'grep',
      ['-r', '-l', stem, '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '.'],
      repoPath,
    )
    return stdout.split('\n').filter(Boolean)
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException & { exitCode?: number }
    if (nodeErr.code === 1 || nodeErr.exitCode === 1) {
      return []
    }
    throw err
  }
}

/**
 * Expand a list of changed file paths by finding all files that import from them
 * (1-hop callers). Uses ripgrep if available, falls back to grep -r.
 *
 * @param changedFiles - List of changed file paths relative to repoPath
 * @param repoPath - Absolute path to the repository root
 * @returns Deduplicated array of file paths: changedFiles ∪ 1-hop-importers
 */
export async function expandImports(
  changedFiles: string[],
  repoPath: string,
): Promise<string[]> {
  if (changedFiles.length === 0) {
    return []
  }

  const resultSet = new Set<string>(changedFiles)

  for (const file of changedFiles) {
    let importers: string[]
    try {
      importers = await searchWithRg(file, repoPath)
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      // rg not found — try grep fallback
      if (nodeErr.code === 'ENOENT') {
        try {
          importers = await searchWithGrep(file, repoPath)
        } catch {
          importers = []
        }
      } else {
        importers = []
      }
    }

    const filtered = filterSourceFiles(importers)
    for (const imp of filtered) {
      resultSet.add(imp)
    }
  }

  return Array.from(resultSet)
}
