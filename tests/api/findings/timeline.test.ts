/**
 * tests/api/findings/timeline.test.ts
 *
 * TDD: T-053 (RED) → T-054 (GREEN)
 * Tests for finding timeline endpoints:
 * - POST /api/findings/[id]/timeline — triggers buildTimeline() async
 * - GET  /api/findings/[id]/timeline — returns TimelineResponse
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { runMigrations } from '@/lib/db/migrate'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { upsertFindingTimeline } from '@/lib/repos/finding-timelines.repo'

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

// Mock buildTimeline so we don't need a real git repo
const mockBuildTimeline = vi.fn(() => Promise.resolve())
vi.mock('@/lib/timeline/timeline-builder', () => ({
  buildTimeline: mockBuildTimeline,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method: string): Request {
  return { method } as unknown as Request
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let findingId: string

beforeEach(async () => {
  vi.clearAllMocks()
  testDb = makeTestDb()

  // Create required project + scan
  const project = createProject(testDb, {
    name: 'test',
    sourceKind: 'local',
    sourceRef: '/tmp/repo',
  })
  const scan = createScan(testDb, { projectId: project.id })

  // Insert a finding row directly via schema
  findingId = 'finding-001'
  testDb.insert(schema.findings).values({
    id: findingId,
    scanId: scan.id,
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.9,
    title: 'Secret exposed',
    description: 'some-secret-value',
    locationPath: 'src/config.ts',
    locationLineStart: 10,
    createdAt: new Date().toISOString(),
  }).run()
})

// ===========================================================================
// POST /api/findings/[id]/timeline
// ===========================================================================

describe('POST /api/findings/[id]/timeline', () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('@/app/api/findings/[id]/timeline/route')
    POST = mod.POST
  })

  it('returns 202 and triggers buildTimeline asynchronously', async () => {
    const req = makeRequest('POST')
    const ctx = makeContext(findingId)

    const response = await POST(req, ctx)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toEqual({ status: 'building' })
  })

  it('calls buildTimeline with the finding id', async () => {
    const req = makeRequest('POST')
    const ctx = makeContext(findingId)

    await POST(req, ctx)

    // buildTimeline is called asynchronously — it's a fire-and-forget
    // Wait a tick to let the promise chain start
    await new Promise((r) => setTimeout(r, 10))
    expect(mockBuildTimeline).toHaveBeenCalledWith(findingId, expect.any(String))
  })

  it('returns 404 when finding does not exist', async () => {
    const req = makeRequest('POST')
    const ctx = makeContext('nonexistent-finding')

    const response = await POST(req, ctx)

    expect(response.status).toBe(404)
  })
})

// ===========================================================================
// GET /api/findings/[id]/timeline
// ===========================================================================

describe('GET /api/findings/[id]/timeline', () => {
  let GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('@/app/api/findings/[id]/timeline/route')
    GET = mod.GET
  })

  it('returns 202 with { status: pending } when timeline not yet built', async () => {
    const req = makeRequest('GET')
    const ctx = makeContext(findingId)

    const response = await GET(req, ctx)

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body).toEqual({ status: 'pending' })
  })

  it('returns 200 with TimelineResponse when timeline exists', async () => {
    // Seed a timeline
    upsertFindingTimeline(testDb, findingId, {
      id: 'tl-001',
      commits: [
        {
          hash: 'abc123',
          date: '2024-01-15T10:00:00Z',
          author: 'dev@test.com',
          message: 'Add config',
          action: 'introduce',
        },
      ],
      suspectedDeploys: 2,
      partial: false,
    })

    const req = makeRequest('GET')
    const ctx = makeContext(findingId)

    const response = await GET(req, ctx)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.findingId).toBe(findingId)
    expect(body.commits).toHaveLength(1)
    expect(body.commits[0].hash).toBe('abc123')
    expect(body.suspectedDeploys).toBe(2)
    expect(body.partial).toBe(false)
    expect(body.computedAt).toBeTruthy()
    expect(body.rotationDraft).toBeDefined()
    expect(body.rotationDraft.githubIssueTitle).toContain('abc123')
    expect(body.rotationDraft.githubIssueBody).toBeTruthy()
    expect(body.rotationDraft.slackMessage).toBeTruthy()
  })

  it('returns 404 when finding does not exist', async () => {
    const req = makeRequest('GET')
    const ctx = makeContext('nonexistent-finding')

    const response = await GET(req, ctx)

    expect(response.status).toBe(404)
  })

  it('rotationDraft uses fallback hash when commits is empty', async () => {
    upsertFindingTimeline(testDb, findingId, {
      id: 'tl-002',
      commits: [],
      suspectedDeploys: 0,
      partial: true,
    })

    const req = makeRequest('GET')
    const ctx = makeContext(findingId)

    const response = await GET(req, ctx)
    const body = await response.json()

    expect(body.rotationDraft.githubIssueTitle).toContain('unknown commit')
  })
})
