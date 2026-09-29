/**
 * lib/timeline/timeline-builder.ts
 *
 * Orchestrates git log parsing and secret timeline persistence for a finding.
 *
 * Workflow:
 * 1. Load the finding from the database by findingId.
 * 2. SHA-256 hash the finding's description (used as the secret identifier in git log -S).
 * 3. Call parseGitLog with the hash (and optional file path).
 * 4. Compute suspectedDeploys: commits within 7 days after the first introduce commit.
 * 5. Upsert the timeline via findingTimelinesRepo.
 * 6. Set findings.timeline_computed_at to the current timestamp.
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { findings } from '@/lib/db/schema'
import { parseGitLog } from './git-log-parser'
import { upsertFindingTimeline } from '@/lib/repos/finding-timelines.repo'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Computes the number of suspected deploy commits.
 *
 * A suspected deploy is any commit that occurred within 7 days after the
 * first `introduce` commit in the timeline (not counting the introduce itself).
 *
 * @param commits - Ordered list of commits from parseGitLog.
 * @returns The count of suspected deploy commits.
 */
function computeSuspectedDeploys(
  commits: Awaited<ReturnType<typeof parseGitLog>>['commits'],
): number {
  if (commits.length === 0) return 0

  // Find the first introduce commit
  const firstIntroduce = commits.find((c) => c.action === 'introduce')
  if (!firstIntroduce) return 0

  const introduceTime = new Date(firstIntroduce.date).getTime()
  const windowEnd = introduceTime + SEVEN_DAYS_MS

  // Count commits that fall within the 7-day window AFTER the introduce (excluding it)
  let count = 0
  for (const commit of commits) {
    if (commit.hash === firstIntroduce.hash) continue
    const commitTime = new Date(commit.date).getTime()
    if (commitTime > introduceTime && commitTime <= windowEnd) {
      count++
    }
  }

  return count
}

/**
 * Builds a secret exposure timeline for a finding.
 *
 * Fetches the finding from the database, hashes its description to use as
 * the git log search string, runs `git log -p -S`, computes suspected deploy
 * count, and persists the result via {@link upsertFindingTimeline}.
 *
 * @param findingId - The primary key of the finding to build the timeline for.
 * @param repoPath - Absolute path to the git repository to search.
 * @param filePath - Optional: limit the git log search to a specific file.
 * @throws {Error} If the finding does not exist in the database.
 */
export async function buildTimeline(
  findingId: string,
  repoPath: string,
  filePath?: string,
): Promise<void> {
  const db = getDb()

  // Step 1: Load finding from DB
  const finding = db
    .select()
    .from(findings)
    .where(eq(findings.id, findingId))
    .get()

  if (!finding) {
    throw new Error(`Finding '${findingId}' not found in database`)
  }

  // Step 2: Hash the finding description (acts as secret identifier for git log -S)
  const secretValue = finding.description ?? ''
  const secretHash = createHash('sha256').update(secretValue).digest('hex')

  // Step 3: Run git log parser
  const { commits, partial } = await parseGitLog(repoPath, secretHash, filePath)

  // Step 4: Compute suspected deploys
  const suspectedDeploys = computeSuspectedDeploys(commits)

  // Step 5: Upsert timeline
  upsertFindingTimeline(db, findingId, {
    id: randomUUID(),
    commits,
    suspectedDeploys,
    partial,
  })

  // Step 6: Update finding.timeline_computed_at
  db.update(findings)
    .set({ timelineComputedAt: new Date().toISOString() })
    .where(eq(findings.id, findingId))
    .run()
}
