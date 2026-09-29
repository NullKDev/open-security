import * as path from 'node:path'
import * as fs from 'node:fs'
import type { ScanEvent } from './events'

export type SourceKind = 'local' | 'github' | 'gitlab' | 'zip'

export interface Stage0Opts {
  scanId: string
  sourceKind: SourceKind
  /** Path, URL, or identifier depending on sourceKind */
  sourceRef: string
  /** Root workspace directory for this scan */
  workspaceRoot: string
  onEvent: (event: ScanEvent) => void
}

export interface Stage0Result {
  ok: boolean
  /** Detected language/framework hints from the source tree (empty if not detected). */
  stackHints?: string[]
  /** Truncated file tree (≤16 KB) for Pass 0 project intelligence. */
  fileTree?: string
  /** Concatenated code snippets sampled from key source files (≤8 KB). */
  sampleSnippets?: string
}

/**
 * Stage 0 — Source Preparation
 *
 * Creates the scan workspace directory and copies/downloads the source
 * into `<workspaceRoot>/source`. Dispatches source ingestion based on
 * sourceKind: local (copy), github/gitlab (clone via HTTP), zip (extract).
 *
 * Emits stage events for progress and error events on failure.
 * Does NOT throw — returns { ok: false } and emits an error event on failure.
 */
export async function runStage0Prep(opts: Stage0Opts): Promise<Stage0Result> {
  const { scanId, sourceKind, sourceRef, workspaceRoot, onEvent } = opts

  onEvent({ type: 'stage', stage: 'prep', message: `[${scanId}] Preparing workspace` })

  const destPath = path.join(workspaceRoot, 'source')
  fs.mkdirSync(destPath, { recursive: true })

  try {
    switch (sourceKind) {
      case 'local':
        await ingestLocal(sourceRef, destPath, workspaceRoot, onEvent)
        break

      case 'github':
      case 'gitlab':
        await ingestGitRemote(sourceRef, destPath, sourceKind, onEvent)
        break

      case 'zip':
        await ingestZip(sourceRef, destPath, workspaceRoot, onEvent)
        break

      default:
        onEvent({ type: 'error', message: `Unknown source kind: ${String(sourceKind)}` })
        return { ok: false }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'error', message: `Stage 0 failed: ${message}` })
    return { ok: false }
  }

  onEvent({
    type: 'stage',
    stage: 'prep',
    message: `[${scanId}] Source ready at ${destPath}`,
  })

  const { stackHints, fileTree, sampleSnippets } = analyzeSource(destPath)
  if (stackHints.length > 0) {
    onEvent({
      type: 'progress',
      message: `[${scanId}] Detected stack: ${stackHints.join(', ')}`,
    })
  }

  return { ok: true, stackHints, fileTree, sampleSnippets }
}

async function ingestLocal(
  sourceRef: string,
  destPath: string,
  _workspaceRoot: string,
  onEvent: (event: ScanEvent) => void,
): Promise<void> {
  onEvent({ type: 'progress', message: `Copying local source from ${sourceRef}` })
  // Use the common ancestor of source and dest as the accepted root
  // to pass path-guard checks. For local ingestion the source may be
  // any path on disk, so we use fs.cp directly.
  const { promises: fsp } = await import('node:fs')
  await fsp.cp(sourceRef, destPath, { recursive: true })
}

async function ingestGitRemote(
  url: string,
  destPath: string,
  kind: 'github' | 'gitlab',
  onEvent: (event: ScanEvent) => void,
): Promise<void> {
  onEvent({ type: 'progress', message: `Cloning ${kind} repository: ${url}` })

  // Dynamic import to avoid pulling in sources in tests where not needed
  if (kind === 'github') {
    const { cloneGitHubRepo } = await import('@/lib/sources/github')
    await cloneGitHubRepo(url, destPath, path.dirname(destPath))
  } else {
    const { cloneGitLabRepo } = await import('@/lib/sources/gitlab')
    await cloneGitLabRepo(url, destPath, path.dirname(destPath))
  }
}

async function ingestZip(
  zipPath: string,
  destPath: string,
  workspaceRoot: string,
  onEvent: (event: ScanEvent) => void,
): Promise<void> {
  onEvent({ type: 'progress', message: `Extracting ZIP: ${zipPath}` })

  const { extractZip } = await import('@/lib/sources/zip')
  await extractZip(zipPath, destPath)
}

// ─── Source Analysis ─────────────────────────────────────────────────────────

const MAX_TREE_BYTES = 16 * 1024
const MAX_SNIPPETS_BYTES = 8 * 1024

/** Marker files → stack hints they imply. */
const STACK_MARKERS: Array<{ file: string; hints: string[] }> = [
  // Android / Mobile
  { file: 'build.gradle',          hints: ['android', 'kotlin', 'gradle'] },
  { file: 'build.gradle.kts',      hints: ['android', 'kotlin', 'gradle-kts'] },
  { file: 'AndroidManifest.xml',   hints: ['android'] },
  { file: 'Podfile',               hints: ['ios', 'swift', 'cocoapods'] },
  { file: 'Package.swift',         hints: ['ios', 'swift', 'spm'] },
  // Web / Node
  { file: 'package.json',          hints: ['node', 'javascript'] },
  { file: 'next.config.js',        hints: ['nextjs', 'react'] },
  { file: 'next.config.ts',        hints: ['nextjs', 'react', 'typescript'] },
  { file: 'angular.json',          hints: ['angular', 'typescript'] },
  { file: 'nuxt.config.ts',        hints: ['nuxt', 'vue', 'typescript'] },
  { file: 'svelte.config.js',      hints: ['svelte'] },
  // Backend
  { file: 'requirements.txt',      hints: ['python'] },
  { file: 'pyproject.toml',        hints: ['python'] },
  { file: 'Pipfile',               hints: ['python'] },
  { file: 'go.mod',                hints: ['go'] },
  { file: 'Cargo.toml',            hints: ['rust'] },
  { file: 'pom.xml',               hints: ['java', 'maven'] },
  { file: 'build.gradle',          hints: ['java', 'gradle'] },
  { file: 'Gemfile',               hints: ['ruby', 'rails'] },
  { file: 'composer.json',         hints: ['php'] },
  { file: 'mix.exs',               hints: ['elixir'] },
  // Cloud / Infra
  { file: 'Dockerfile',            hints: ['docker'] },
  { file: 'docker-compose.yml',    hints: ['docker', 'docker-compose'] },
  { file: 'terraform.tf',          hints: ['terraform'] },
  { file: 'main.tf',               hints: ['terraform'] },
  { file: 'serverless.yml',        hints: ['serverless', 'aws'] },
  { file: 'kubernetes.yml',        hints: ['kubernetes'] },
  { file: '.github/workflows',     hints: ['github-actions', 'cicd'] },
  { file: '.gitlab-ci.yml',        hints: ['gitlab-ci', 'cicd'] },
]

/** File extensions that contain interesting source code for sampling. */
const SOURCE_EXTENSIONS = new Set([
  '.kt', '.java', '.swift', '.m', '.dart',       // mobile
  '.ts', '.tsx', '.js', '.jsx',                   // web
  '.py', '.go', '.rs', '.rb', '.php', '.cs',     // backend
  '.tf', '.yaml', '.yml', '.json',                // infra / config
])

/** Directories to skip when walking the tree. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.gradle', 'build', 'dist', '__pycache__',
  '.next', 'out', 'target', 'vendor', '.idea', '.vscode', 'Pods',
  'DerivedData', '.kotlin', 'intermediates', 'generated',
])

/** Walk a directory, building a text tree and collecting source snippets. */
function analyzeSource(rootDir: string): {
  stackHints: string[]
  fileTree: string
  sampleSnippets: string
} {
  const hints = new Set<string>()
  const treeLines: string[] = []
  const snippetParts: string[] = []
  let treeBytes = 0
  let snippetBytes = 0

  // Check marker files at root
  for (const { file, hints: h } of STACK_MARKERS) {
    if (fs.existsSync(path.join(rootDir, file))) {
      h.forEach((hint) => hints.add(hint))
    }
  }

  // Walk the tree
  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 8) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Dirs first, then files — mirrors conventional tree output
    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name)
      return a.isDirectory() ? -1 : 1
    })

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (treeBytes >= MAX_TREE_BYTES) break

      const line = `${prefix}${entry.isDirectory() ? '📁 ' : ''}${entry.name}\n`
      treeBytes += line.length
      treeLines.push(line)

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix + '  ', depth + 1)
      } else if (snippetBytes < MAX_SNIPPETS_BYTES) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SOURCE_EXTENSIONS.has(ext)) {
          try {
            const fullPath = path.join(dir, entry.name)
            const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 1500)
            const header = `\n### ${path.relative(rootDir, fullPath)}\n`
            snippetParts.push(header + content)
            snippetBytes += header.length + content.length
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  walk(rootDir, '', 0)

  return {
    stackHints: [...hints],
    fileTree: treeLines.join('').slice(0, MAX_TREE_BYTES),
    sampleSnippets: snippetParts.join('\n').slice(0, MAX_SNIPPETS_BYTES),
  }
}
