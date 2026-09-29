import { execFile as execFileCb, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { platform } from 'node:os'
import { promisify } from 'node:util'
import { AGENT_DEFS, DEFAULT_MODEL_OPTION, getAgentDef } from './agents'
import type { AgentDef, AgentModelOption, StreamFormat } from './agents'

const execFile = promisify(execFileCb)

/**
 * Signature for a function that checks whether a binary exists on PATH.
 * Injectable for testing.
 */
export type AccessChecker = (name: string) => boolean

/** Full probe result for a CLI agent */
export interface AgentProbeResult {
  id: string
  name: string
  bin: string
  available: boolean
  path: string | null
  version: string | null
  models: AgentModelOption[]
  streamFormat: StreamFormat
}

/**
 * Locate a binary by scanning PATH directories.
 * Returns the full absolute path, or null if not found.
 */
export function findOnPath(bin: string): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter)
  const exts =
    platform() === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, bin + ext)
      if (full && existsSync(full)) return full
    }
  }
  return null
}

/**
 * Check whether a binary is available on the system PATH.
 *
 * Accepts an optional custom checker for testing.
 * Returns true if the binary can be found.
 */
export function resolveOnPath(name: string, check?: AccessChecker): boolean {
  if (check) return check(name)
  return findOnPath(name) !== null
}

async function fetchModels(def: AgentDef, resolvedBin: string): Promise<AgentModelOption[]> {
  const fallback = def.fallbackModels ?? [DEFAULT_MODEL_OPTION]
  if (!def.listModels) return fallback
  try {
    const { stdout } = await execFile(resolvedBin, def.listModels.args, {
      timeout: def.listModels.timeoutMs ?? 5000,
      maxBuffer: 8 * 1024 * 1024,
    })
    const parsed = def.listModels.parse(String(stdout))
    if (!parsed || parsed.length === 0) return fallback
    return parsed
  } catch {
    return fallback
  }
}

/**
 * Run a full probe for a single agent: PATH check, version, model discovery.
 * Never throws — failures produce an unavailable result with fallback models.
 */
export async function probeAgentFull(def: AgentDef): Promise<AgentProbeResult> {
  const fallback = def.fallbackModels ?? [DEFAULT_MODEL_OPTION]
  const resolvedPath = findOnPath(def.bin)

  if (!resolvedPath) {
    return {
      id: def.id,
      name: def.name ?? def.id,
      bin: def.bin,
      available: false,
      path: null,
      version: null,
      models: fallback,
      streamFormat: def.streamFormat,
    }
  }

  let version: string | null = null
  try {
    const { stdout } = await execFile(resolvedPath, def.probeArgs, { timeout: 3000 })
    version = String(stdout).trim().split('\n')[0] ?? null
  } catch {}

  const models = await fetchModels(def, resolvedPath)

  return {
    id: def.id,
    name: def.name ?? def.id,
    bin: def.bin,
    available: true,
    path: resolvedPath,
    version,
    models,
    streamFormat: def.streamFormat,
  }
}

/** Probe all registered CLI agents in parallel */
export async function probeAllAgents(): Promise<AgentProbeResult[]> {
  return Promise.all(AGENT_DEFS.map((def) => probeAgentFull(def)))
}

/**
 * Probe an agent definition to verify the binary is available.
 *
 * Kept for backward compatibility with tests. Accepts an optional execFn
 * for testing the probe command execution.
 */
export async function probeAgent(
  def: AgentDef,
  check?: AccessChecker,
  execFn?: (bin: string, args: string[]) => Buffer | string,
): Promise<boolean> {
  if (!resolveOnPath(def.bin, check)) return false

  if (!execFn) return true

  try {
    execFn(def.bin, def.probeArgs)
    return true
  } catch {
    return false
  }
}

// Re-export for convenience
export { getAgentDef }
