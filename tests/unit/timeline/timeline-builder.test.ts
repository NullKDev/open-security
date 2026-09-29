/**
 * tests/unit/timeline/timeline-builder.test.ts
 *
 * Unit tests for TimelineBuilder — orchestrates git log parsing + timeline persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockParseGitLog,
  mockUpsertFindingTimeline,
  mockGetDb,
  mockDbSelect,
  mockDbWhere,
  mockDbGet,
} = vi.hoisted(() => {
  const mockDbGet = vi.fn()
  const mockDbWhere = vi.fn().mockReturnValue({ get: mockDbGet })
  const mockDbSelectFrom = vi.fn().mockReturnValue({ where: mockDbWhere })
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbSelectFrom })
  const mockGetDb = vi.fn().mockReturnValue({
    select: mockDbSelect,
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ run: vi.fn() }),
      }),
    }),
  })

  return {
    mockParseGitLog: vi.fn(),
    mockUpsertFindingTimeline: vi.fn(),
    mockGetDb,
    mockDbSelect,
    mockDbWhere,
    mockDbGet,
  }
})

vi.mock('@/lib/timeline/git-log-parser', () => ({
  parseGitLog: mockParseGitLog,
}))

vi.mock('@/lib/repos/finding-timelines.repo', () => ({
  upsertFindingTimeline: mockUpsertFindingTimeline,
}))

vi.mock('@/lib/db/client', () => ({
  getDb: mockGetDb,
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { buildTimeline } from '@/lib/timeline/timeline-builder'
import type { CommitInfo } from '@/lib/timeline/git-log-parser'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123',
    author: 'Alice',
    email: 'alice@example.com',
    date: '2024-01-15T10:00:00+00:00',
    action: 'introduce',
    ...overrides,
  }
}

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'finding-001',
    description: 'my-secret-value-abc123',
    locationPath: 'src/config.ts',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: finding found in DB
    mockDbGet.mockReturnValue(makeFinding())
    // Default: git log returns a simple result
    mockParseGitLog.mockResolvedValue({ commits: [], partial: false })
  })

  // -------------------------------------------------------------------------
  // Basic orchestration
  // -------------------------------------------------------------------------
  it('calls parseGitLog with a SHA-256 hash of the finding description', async () => {
    mockParseGitLog.mockResolvedValue({ commits: [], partial: false })

    await buildTimeline('finding-001', '/repo')

    expect(mockParseGitLog).toHaveBeenCalledOnce()
    const [repoPath, secretHash] = mockParseGitLog.mock.calls[0]
    expect(repoPath).toBe('/repo')
    // secretHash should be a 64-char hex string (SHA-256)
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('passes the optional filePath to parseGitLog when provided', async () => {
    mockParseGitLog.mockResolvedValue({ commits: [], partial: false })

    await buildTimeline('finding-001', '/repo', 'src/config.ts')

    const [, , filePath] = mockParseGitLog.mock.calls[0]
    expect(filePath).toBe('src/config.ts')
  })

  it('does not pass filePath to parseGitLog when omitted', async () => {
    mockParseGitLog.mockResolvedValue({ commits: [], partial: false })

    await buildTimeline('finding-001', '/repo')

    const [, , filePath] = mockParseGitLog.mock.calls[0]
    expect(filePath).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // Upsert called with commit data + partial flag propagated
  // -------------------------------------------------------------------------
  it('calls upsertFindingTimeline with commits and partial flag from parseGitLog', async () => {
    const commits = [makeCommit(), makeCommit({ hash: 'def456', action: 'remove' })]
    mockParseGitLog.mockResolvedValue({ commits, partial: false })

    await buildTimeline('finding-001', '/repo')

    expect(mockUpsertFindingTimeline).toHaveBeenCalledOnce()
    const [, findingId, input] = mockUpsertFindingTimeline.mock.calls[0]
    expect(findingId).toBe('finding-001')
    expect(input.commits).toHaveLength(2)
    expect(input.partial).toBe(false)
  })

  it('propagates partial:true from parseGitLog result to upsertFindingTimeline', async () => {
    mockParseGitLog.mockResolvedValue({ commits: [makeCommit()], partial: true })

    await buildTimeline('finding-001', '/repo')

    const [, , input] = mockUpsertFindingTimeline.mock.calls[0]
    expect(input.partial).toBe(true)
  })

  // -------------------------------------------------------------------------
  // suspectedDeploys: commits on main/master branches within 7-day window
  // -------------------------------------------------------------------------
  it('computes suspectedDeploys as 0 when no introduce commits exist', async () => {
    mockParseGitLog.mockResolvedValue({ commits: [], partial: false })

    await buildTimeline('finding-001', '/repo')

    const [, , input] = mockUpsertFindingTimeline.mock.calls[0]
    expect(input.suspectedDeploys).toBe(0)
  })

  it('computes suspectedDeploys > 0 when commits exist after first introduce', async () => {
    // First commit introduces the secret
    const introduceDate = new Date('2024-01-01T10:00:00Z')
    // Two commits within 7 days after introduce
    const day3 = new Date(introduceDate.getTime() + 3 * 24 * 60 * 60 * 1000)
    const day5 = new Date(introduceDate.getTime() + 5 * 24 * 60 * 60 * 1000)
    // One commit outside the 7-day window
    const day10 = new Date(introduceDate.getTime() + 10 * 24 * 60 * 60 * 1000)

    const commits: CommitInfo[] = [
      makeCommit({ date: introduceDate.toISOString(), action: 'introduce' }),
      makeCommit({ hash: 'b1', date: day3.toISOString(), action: 'introduce' }),
      makeCommit({ hash: 'b2', date: day5.toISOString(), action: 'introduce' }),
      makeCommit({ hash: 'b3', date: day10.toISOString(), action: 'introduce' }),
    ]

    mockParseGitLog.mockResolvedValue({ commits, partial: false })

    await buildTimeline('finding-001', '/repo')

    const [, , input] = mockUpsertFindingTimeline.mock.calls[0]
    // 2 commits within 7 days after the introduce (not counting the introduce itself)
    expect(input.suspectedDeploys).toBe(2)
  })

  // -------------------------------------------------------------------------
  // Finding not found → throws or returns early
  // -------------------------------------------------------------------------
  it('throws when finding is not found in the database', async () => {
    mockDbGet.mockReturnValue(undefined)

    await expect(buildTimeline('nonexistent', '/repo')).rejects.toThrow()
  })
})
