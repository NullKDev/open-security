import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import path from 'node:path'
import { ObtConfig, defaultConfig } from './schema'
import type { ObtConfig as ObtConfigType } from './schema'
import { getDb } from '@/lib/db/client'
import { config as configTable } from '@/lib/db/schema'

export { ObtConfig, defaultConfig } from './schema'

const DEFAULT_OBT_ROOT = path.join(process.cwd(), '.obt')

export const OBT_ROOT = DEFAULT_OBT_ROOT
export const OBT_CONFIG_PATH = path.join(DEFAULT_OBT_ROOT, 'config.json')
export const OBT_DB_PATH = path.join(DEFAULT_OBT_ROOT, 'db.sqlite')

export async function ensureObtDirs(root: string = DEFAULT_OBT_ROOT): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path.join(root, 'projects'), { recursive: true })
  await mkdir(path.join(root, 'reports'), { recursive: true })
}

const CONFIG_KEY = 'app-config'

/**
 * Read the current application config.
 *
 * Reads from the `config` table in the SQLite database. On first run (no DB
 * entry yet), falls back to `.obt/config.json` for backward compatibility,
 * then migrates it into the DB so subsequent reads come from there.
 */
export function readConfig(): ObtConfigType {
  const db = getDb()
  const row = db.select().from(configTable).where(eq(configTable.key, CONFIG_KEY)).get()

  if (row) {
    try {
      return ObtConfig.parse(JSON.parse(row.value))
    } catch {
      return defaultConfig
    }
  }

  // First-run migration: read from legacy JSON file if it exists
  const legacy = readLegacyConfigFile()
  if (legacy) {
    writeConfig(legacy)
    return legacy
  }

  return defaultConfig
}

/**
 * Persist the config to the `config` table in the SQLite database.
 */
export function writeConfig(cfg: ObtConfigType): void {
  const db = getDb()
  db.insert(configTable)
    .values({ key: CONFIG_KEY, value: JSON.stringify(cfg) })
    .onConflictDoUpdate({ target: configTable.key, set: { value: JSON.stringify(cfg) } })
    .run()
}

function readLegacyConfigFile(): ObtConfigType | null {
  mkdirSync(DEFAULT_OBT_ROOT, { recursive: true })
  if (!existsSync(OBT_CONFIG_PATH)) return null
  try {
    const raw = readFileSync(OBT_CONFIG_PATH, 'utf-8')
    return ObtConfig.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export interface PublicConfig {
  models: ObtConfigType['models']
  providers: {
    anthropicKey: boolean
    openaiKey: boolean
    googleKey: boolean
  }
  theme: ObtConfigType['theme']
  workerMemoryMb: number
  stage2Concurrency: number
}

export function getPublicConfig(): PublicConfig {
  const cfg = readConfig()
  return {
    models: cfg.models,
    providers: {
      anthropicKey: Boolean(cfg.providers.anthropicKey),
      openaiKey: Boolean(cfg.providers.openaiKey),
      googleKey: Boolean(cfg.providers.googleKey),
    },
    theme: cfg.theme,
    workerMemoryMb: cfg.workerMemoryMb,
    stage2Concurrency: cfg.stage2Concurrency,
  }
}
