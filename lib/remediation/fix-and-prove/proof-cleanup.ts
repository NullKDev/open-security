/**
 * proof-cleanup.ts — Boot-time cleanup of stale in-progress proofs
 *
 * Finds fix_proofs rows stuck in 'in-progress' older than 1 hour
 * (orphaned from a prior crash) and marks them as 'fix-unverified'.
 * Also calls `git worktree prune` on all project source trees.
 *
 * Intended to be called once at application startup via instrumentation.ts.
 */
import { and, eq, lt } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { fixProofs, projects } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { runGitCommand } from '@/lib/remediation/git-ops'

type DB = BetterSQLite3Database<typeof schema>

const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour
const GIT_TIMEOUT_MS = 30_000

/**
 * Cleans up stale in-progress fix proofs and prunes orphaned git worktrees.
 *
 * This function:
 * 1. Finds all fix_proofs rows with outcome='in-progress' older than 1 hour
 * 2. Updates them to outcome='fix-unverified', failureReason='agent-error'
 * 3. Calls `git worktree prune` on every project's sourceRef directory
 * 4. Returns the count of proofs that were cleaned
 *
 * Non-fatal: git failures are silently ignored (best-effort cleanup).
 *
 * @param db - Drizzle database instance
 * @returns Number of proof rows cleaned up
 */
export async function pruneStaleProofs(db: DB): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()
  const now = new Date().toISOString()

  // Step 1: Find stale in-progress proofs
  const stale = db
    .select({ id: fixProofs.id })
    .from(fixProofs)
    .where(
      and(
        eq(fixProofs.outcome, 'in-progress'),
        lt(fixProofs.startedAt, cutoff),
      ),
    )
    .all()

  // Step 2: Mark them as fix-unverified if any
  if (stale.length > 0) {
    db.update(fixProofs)
      .set({
        outcome: 'fix-unverified',
        failureReason: 'agent-error',
        completedAt: now,
      })
      .where(
        and(
          eq(fixProofs.outcome, 'in-progress'),
          lt(fixProofs.startedAt, cutoff),
        ),
      )
      .run()
  }

  // Step 3: Prune worktrees for all projects (best-effort, silently continue on failure)
  const allProjects = db
    .select({ id: projects.id, sourceRef: projects.sourceRef })
    .from(projects)
    .all()

  for (const project of allProjects) {
    try {
      await runGitCommand(project.sourceRef, ['worktree', 'prune'], GIT_TIMEOUT_MS)
    } catch {
      // Best-effort: ignore git errors at cleanup time
    }
  }

  return stale.length
}
