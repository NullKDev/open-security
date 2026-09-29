import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import type { ObtConfig } from '@/lib/config/schema'

// ─── Inject an in-memory DB for each test ─────────────────────────────────────

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/client')>()
  return {
    ...actual,
    getDb: () => testDb,
  }
})

beforeEach(() => {
  testDb = createTestDb(new Database(':memory:'))
})

// Import after mock is set up
const { readConfig, writeConfig, getPublicConfig } = await import('@/lib/config/store')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('readConfig', () => {
  it('returns default values when no config is stored', () => {
    const cfg = readConfig()
    expect(cfg.theme).toBe('dark')
    expect(cfg.workerMemoryMb).toBe(2048)
    expect(cfg.stage2Concurrency).toBe(4)
  })
})

describe('writeConfig / readConfig round-trip', () => {
  it('persists and retrieves the full config', () => {
    const original: ObtConfig = {
      models: { 'llm-scan': 'cli:opencode:gpt-4o' },
      providers: { anthropicKey: 'sk-ant-test' },
      theme: 'light',
      workerMemoryMb: 1024,
      stage2Concurrency: 2,
      features: { policies: true, collaboration: true, consensus: true },
      integrations: { jira: {}, slack: {}, githubCodeScanning: {}, socket: {} },
    }
    writeConfig(original)
    const loaded = readConfig()
    expect(loaded).toEqual(original)
  })

  it('overwrites previous config on subsequent writes', () => {
    const v1: ObtConfig = { models: {}, providers: {}, theme: 'light', workerMemoryMb: 512, stage2Concurrency: 1, features: { policies: true, collaboration: true, consensus: true }, integrations: { jira: {}, slack: {}, githubCodeScanning: {}, socket: {} } }
    const v2: ObtConfig = { models: {}, providers: {}, theme: 'dark', workerMemoryMb: 4096, stage2Concurrency: 8, features: { policies: true, collaboration: true, consensus: true }, integrations: { jira: {}, slack: {}, githubCodeScanning: {}, socket: {} } }
    writeConfig(v1)
    writeConfig(v2)
    expect(readConfig()).toEqual(v2)
  })
})

describe('getPublicConfig', () => {
  it('returns presence flags instead of raw key values', () => {
    const cfg: ObtConfig = {
      models: {},
      providers: { anthropicKey: 'sk-ant-secret', openaiKey: 'sk-openai-secret' },
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    }
    writeConfig(cfg)
    const pub = getPublicConfig()
    expect(typeof pub.providers.anthropicKey).toBe('boolean')
    expect(pub.providers.anthropicKey).toBe(true)
    expect(pub.providers.openaiKey).toBe(true)
    expect(pub.providers.googleKey).toBe(false)
    expect(JSON.stringify(pub)).not.toContain('sk-ant-secret')
    expect(JSON.stringify(pub)).not.toContain('sk-openai-secret')
  })
})
