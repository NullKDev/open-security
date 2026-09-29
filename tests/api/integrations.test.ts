/**
 * tests/api/integrations.test.ts
 *
 * TDD RED → GREEN: T-041 — PUT /api/integrations/[target]
 *
 * Covers:
 * - Jira target: accepts baseUrl + email + projectKey (non-sensitive) + apiToken (secret)
 * - Slack target: accepts webhookUrl (secret)
 * - github-code-scanning target: accepts owner + repo (non-sensitive) + pat (secret)
 * - socket target: accepts apiKey (secret)
 * - Unknown target → 400
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

vi.mock('@/lib/pipeline/runner', () => ({
  runPipeline: vi.fn(() => ({ done: Promise.resolve(), abort: vi.fn() })),
}))
vi.mock('@/lib/pipeline/shared-bus', () => ({
  sharedBus: { subscribe: vi.fn(), publish: vi.fn(), destroy: vi.fn(), replay: vi.fn(() => []) },
}))

// Mock secret-store to avoid needing real machine key
vi.mock('@/lib/security/secret-store', () => ({
  createSecretStore: () => ({
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/security/machine-key', () => ({
  deriveMachineKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
}))

import { PUT } from '@/app/api/integrations/[target]/route'

interface RouteContext {
  params: Promise<{ target: string }>
}

function makeContext(target: string): RouteContext {
  return { params: Promise.resolve({ target }) }
}

function makeRequest(target: string, body: unknown): Request {
  return new Request(`http://localhost/api/integrations/${target}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/integrations/[target]', () => {
  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()
  })

  it('accepts jira config and returns ok', async () => {
    const req = makeRequest('jira', {
      baseUrl: 'https://test.atlassian.net',
      projectKey: 'SEC',
      email: 'user@example.com',
      apiToken: 'secret-token',
    })
    const res = await PUT(req, makeContext('jira'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.ok).toBe(true)
  })

  it('accepts slack config and returns ok', async () => {
    const req = makeRequest('slack', {
      webhookUrl: 'https://hooks.slack.com/services/TEST',
    })
    const res = await PUT(req, makeContext('slack'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('accepts github-code-scanning config and returns ok', async () => {
    const req = makeRequest('github-code-scanning', {
      owner: 'test-owner',
      repo: 'test-repo',
      pat: 'ghp_test-token',
    })
    const res = await PUT(req, makeContext('github-code-scanning'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('accepts socket config and returns ok', async () => {
    const req = makeRequest('socket', {
      apiKey: 'socket-key-abc',
    })
    const res = await PUT(req, makeContext('socket'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 400 for unknown target', async () => {
    const req = makeRequest('unknown-tool', { someField: 'value' })
    const res = await PUT(req, makeContext('unknown-tool'))

    expect(res.status).toBe(400)
  })
})
