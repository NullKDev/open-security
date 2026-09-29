/**
 * tests/unit/remediation/proof-cleanup.test.ts
 *
 * TDD: T-047 (RED) → GREEN — proof-cleanup.ts
 *
 * Tests the pruneStaleProofs function which:
 * 1. Finds fix_proofs rows with outcome='in-progress' older than 1 hour
 * 2. Marks them as outcome='fix-unverified', failureReason='agent-error'
 * 3. Calls git worktree prune on each project's sourceRef path
 * 4. Returns count of proofs cleaned
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock git-ops before imports
vi.mock('@/lib/remediation/git-ops', () => ({
  runGitCommand: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
}))

import { pruneStaleProofs } from '@/lib/remediation/fix-and-prove/proof-cleanup'
import { runGitCommand } from '@/lib/remediation/git-ops'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

type MockDB = {
  select: () => MockDB
  from: (_t: unknown) => MockDB
  all: () => unknown[]
  update: () => MockDB
  set: (_v: unknown) => MockDB
  where: (_c: unknown) => MockDB
  run: () => void
}

function makeMockDb(options: {
  staleProofs?: { id: string; findingId: string }[]
  projects?: { id: string; sourceRef: string }[]
}): BetterSQLite3Database<typeof schema> {
  const staleProofs = options.staleProofs ?? []
  const projects = options.projects ?? []

  // Simple call-tracking mock
  const mock = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn()
      .mockReturnValueOnce(staleProofs)   // First call: stale proofs
      .mockReturnValueOnce(projects),     // Second call: projects
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    run: vi.fn(),
  }

  return mock as unknown as BetterSQLite3Database<typeof schema>
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pruneStaleProofs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when no stale proofs exist', async () => {
    const db = makeMockDb({ staleProofs: [], projects: [] })
    const count = await pruneStaleProofs(db)
    expect(count).toBe(0)
  })

  it('returns count of proofs cleaned', async () => {
    const db = makeMockDb({
      staleProofs: [
        { id: 'proof-1', findingId: 'f-1' },
        { id: 'proof-2', findingId: 'f-2' },
      ],
      projects: [],
    })
    const count = await pruneStaleProofs(db)
    expect(count).toBe(2)
  })

  it('marks stale proofs as fix-unverified with agent-error reason', async () => {
    const db = makeMockDb({
      staleProofs: [{ id: 'proof-1', findingId: 'f-1' }],
      projects: [],
    })
    await pruneStaleProofs(db)
    expect((db as unknown as MockDB).update).toHaveBeenCalled()
    expect((db as unknown as MockDB).set).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'fix-unverified',
        failureReason: 'agent-error',
      })
    )
  })

  it('calls git worktree prune for each project', async () => {
    const db = makeMockDb({
      staleProofs: [],
      projects: [
        { id: 'proj-1', sourceRef: '/repos/proj-1' },
        { id: 'proj-2', sourceRef: '/repos/proj-2' },
      ],
    })
    await pruneStaleProofs(db)
    expect(runGitCommand).toHaveBeenCalledWith(
      '/repos/proj-1',
      ['worktree', 'prune'],
      expect.any(Number)
    )
    expect(runGitCommand).toHaveBeenCalledWith(
      '/repos/proj-2',
      ['worktree', 'prune'],
      expect.any(Number)
    )
  })

  it('does not call git worktree prune when no projects exist', async () => {
    const db = makeMockDb({ staleProofs: [], projects: [] })
    await pruneStaleProofs(db)
    expect(runGitCommand).not.toHaveBeenCalled()
  })

  it('silently continues if git worktree prune fails', async () => {
    vi.mocked(runGitCommand).mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'error: some git error',
    })
    const db = makeMockDb({
      staleProofs: [],
      projects: [{ id: 'proj-1', sourceRef: '/repos/proj-1' }],
    })
    // Should not throw even when git fails
    await expect(pruneStaleProofs(db)).resolves.toBe(0)
  })
})
