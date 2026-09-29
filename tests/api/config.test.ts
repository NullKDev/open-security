/**
 * tests/api/config.test.ts
 * Tests for GET /api/config and PUT /api/config
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

// Mock config store to work with tmpdir
vi.mock('@/lib/config/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/config/store')>()
  return {
    ...mod,
    OBT_ROOT: '/tmp/obt-test-config',
    OBT_CONFIG_PATH: '/tmp/obt-test-config/config.json',
  }
})

import { GET, PUT } from '@/app/api/config/route'

describe('GET /api/config', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 200 with public config', async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.models).toBeDefined()
    expect(body.data.providers).toBeDefined()
    expect(typeof body.data.providers.anthropicKey).toBe('boolean')
    expect(typeof body.data.providers.openaiKey).toBe('boolean')
    expect(typeof body.data.providers.googleKey).toBe('boolean')
  })

  it('never exposes raw API keys', async () => {
    const res = await GET()
    const body = await res.json()

    // API keys should be booleans (presence only), never strings
    expect(typeof body.data.providers.anthropicKey).toBe('boolean')
    expect(typeof body.data.providers.openaiKey).toBe('boolean')
    expect(typeof body.data.providers.googleKey).toBe('boolean')
  })
})

describe('PUT /api/config', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('returns 400 for invalid body', async () => {
    const req = new Request('http://localhost/api/config', {
      method: 'PUT',
      body: JSON.stringify({ models: 'not-an-object', theme: 'invalid-theme' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PUT(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 200 with updated config for valid body', async () => {
    const req = new Request('http://localhost/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        models: {
          'llm-scan': 'api:anthropic:claude-sonnet-4',
        },
        providers: {
          anthropicKey: 'sk-ant-test',
        },
        theme: 'dark',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PUT(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    // Key should NEVER be echoed back
    expect(typeof body.data.providers.anthropicKey).toBe('boolean')
  })
})
