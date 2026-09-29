/**
 * tests/api/playbooks.test.ts
 *
 * TDD: T-051 (RED) → T-052 (GREEN)
 * Tests for playbook CRUD endpoints:
 * - GET  /api/playbooks
 * - POST /api/playbooks
 * - DELETE /api/playbooks/[id]
 *
 * All routes gated behind OBT_CONSOLE_V2=1.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { runMigrations } from '@/lib/db/migrate'

// ---------------------------------------------------------------------------
// In-memory DB
// ---------------------------------------------------------------------------

function makeTestDb() {
  const sqlite = new Database(':memory:')
  runMigrations(sqlite)
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

let testDb: ReturnType<typeof makeTestDb>

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => testDb),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string, body?: unknown): Request {
  return {
    json: () => Promise.resolve(body ?? {}),
    method,
  } as unknown as Request
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

const VALID_PLAYBOOK = {
  id: 'test-playbook-001',
  name: 'Test Playbook',
  version: '1.0.0',
  promptTemplate: 'Analyze {{targetPath}} for {{cveId}}',
  source: 'user' as const,
}

// ---------------------------------------------------------------------------
// Feature flag guard
// ---------------------------------------------------------------------------

describe('Playbook API routes — feature flag off', () => {
  let GET: (req: Request) => Promise<Response>
  let POST: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = makeTestDb()
    delete process.env.OBT_CONSOLE_V2

    vi.resetModules()
    const mod = await import('@/app/api/playbooks/route')
    GET = mod.GET
    POST = mod.POST
  })

  it('GET returns 404 when OBT_CONSOLE_V2 is not set', async () => {
    const req = makeRequest('GET')
    const response = await GET(req)
    expect(response.status).toBe(404)
  })

  it('POST returns 404 when OBT_CONSOLE_V2 is not set', async () => {
    const req = makeRequest('POST', VALID_PLAYBOOK)
    const response = await POST(req)
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /api/playbooks
// ---------------------------------------------------------------------------

describe('GET /api/playbooks', () => {
  let GET: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = makeTestDb()
    process.env.OBT_CONSOLE_V2 = '1'

    vi.resetModules()
    const mod = await import('@/app/api/playbooks/route')
    GET = mod.GET
  })

  it('returns 200 with an array', async () => {
    const req = makeRequest('GET')
    const response = await GET(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('includes user-created playbooks', async () => {
    // First create a playbook via POST
    const mod = await import('@/app/api/playbooks/route')
    await mod.POST(makeRequest('POST', VALID_PLAYBOOK))

    const response = await GET(makeRequest('GET'))
    const body = await response.json()
    const ids = body.data.map((p: { id: string }) => p.id)
    expect(ids).toContain(VALID_PLAYBOOK.id)
  })
})

// ---------------------------------------------------------------------------
// POST /api/playbooks
// ---------------------------------------------------------------------------

describe('POST /api/playbooks', () => {
  let POST: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = makeTestDb()
    process.env.OBT_CONSOLE_V2 = '1'

    vi.resetModules()
    const mod = await import('@/app/api/playbooks/route')
    POST = mod.POST
  })

  it('returns 201 with the created playbook for valid body', async () => {
    const req = makeRequest('POST', VALID_PLAYBOOK)
    const response = await POST(req)

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.data).toMatchObject({
      id: VALID_PLAYBOOK.id,
      name: VALID_PLAYBOOK.name,
      source: 'user',
    })
  })

  it('returns 400 when promptTemplate is missing', async () => {
    const { promptTemplate: _pt, ...withoutTemplate } = VALID_PLAYBOOK
    const req = makeRequest('POST', withoutTemplate)
    const response = await POST(req)

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when name is missing', async () => {
    const { name: _n, ...withoutName } = VALID_PLAYBOOK
    const req = makeRequest('POST', withoutName)
    const response = await POST(req)

    expect(response.status).toBe(400)
  })

  it('returns 400 when source is not "user"', async () => {
    const req = makeRequest('POST', { ...VALID_PLAYBOOK, source: 'builtin' })
    const response = await POST(req)

    expect(response.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/playbooks/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/playbooks/[id]', () => {
  let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  let POST: (req: Request) => Promise<Response>

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = makeTestDb()
    process.env.OBT_CONSOLE_V2 = '1'

    vi.resetModules()
    const listMod = await import('@/app/api/playbooks/route')
    POST = listMod.POST
    const idMod = await import('@/app/api/playbooks/[id]/route')
    DELETE = idMod.DELETE
  })

  it('returns 204 for an existing playbook', async () => {
    // Create first
    await POST(makeRequest('POST', VALID_PLAYBOOK))

    const response = await DELETE(makeRequest('DELETE'), makeContext(VALID_PLAYBOOK.id))
    expect(response.status).toBe(204)
  })

  it('returns 404 for a non-existent playbook', async () => {
    const response = await DELETE(makeRequest('DELETE'), makeContext('nonexistent-id'))
    expect(response.status).toBe(404)
  })
})
