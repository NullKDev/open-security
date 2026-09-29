/**
 * GET  /api/findings/[id]/timeline — get the secret exposure timeline for a finding
 * POST /api/findings/[id]/timeline — trigger async timeline build
 *
 * Status codes (POST):
 * - 202 `{ status: 'building' }` — build triggered
 * - 404 — finding not found
 *
 * Status codes (GET):
 * - 200 `TimelineResponse` — timeline data with rotationDraft
 * - 202 `{ status: 'pending' }` — timeline not yet computed
 * - 404 — finding not found
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { getFindingById } from '@/lib/repos/findings.repo'
import { getScanById } from '@/lib/repos/scans.repo'
import { getProjectById } from '@/lib/repos/projects.repo'
import { findTimelineByFindingId } from '@/lib/repos/finding-timelines.repo'
import { buildTimeline } from '@/lib/timeline/timeline-builder'
import type { CommitInfo } from '@/lib/timeline/git-log-parser'

interface RouteContext {
  params: Promise<{ id: string }>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full timeline response shape returned by GET. */
export interface TimelineResponse {
  findingId: string
  commits: CommitInfo[]
  suspectedDeploys: number
  partial: boolean
  computedAt: string | null
  rotationDraft: {
    githubIssueTitle: string
    githubIssueBody: string
    slackMessage: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the rotation draft templates from a list of commits.
 *
 * @param findingId - The finding this draft is for
 * @param commits - Ordered commit list from the timeline
 * @returns Pre-filled draft with github + slack templates
 */
function buildRotationDraft(
  findingId: string,
  commits: CommitInfo[],
): TimelineResponse['rotationDraft'] {
  const firstHash = commits[0]?.hash ?? 'unknown commit'
  const commitCount = commits.length

  const githubIssueTitle = `[Security] Rotate secret exposed in ${firstHash}`

  const commitList = commits
    .map((c) => `- \`${c.hash}\` ${c.date} — ${c.message ?? '(no message)'}`)
    .join('\n')

  const githubIssueBody = [
    `## Secret Rotation Required`,
    ``,
    `**Finding**: \`${findingId}\``,
    `**First exposed**: \`${firstHash}\``,
    ``,
    `### Commits exposing the secret`,
    commitList || '_No commits found_',
    ``,
    `**Action**: Rotate this secret immediately and revoke all active tokens.`,
  ].join('\n')

  const slackMessage =
    commitCount > 0
      ? `⚠️ Secret exposed in ${commitCount} commit(s) starting at ${firstHash}. Rotate immediately.`
      : `⚠️ Secret exposure detected for finding ${findingId}. Rotate immediately.`

  return { githubIssueTitle, githubIssueBody, slackMessage }
}

// ---------------------------------------------------------------------------
// POST /api/findings/[id]/timeline
// ---------------------------------------------------------------------------

/**
 * Triggers an asynchronous timeline build for a finding.
 * Uses the finding's scan project source ref as the repository path.
 *
 * @param _req - Incoming POST request (body not used)
 * @param context - Next.js route context with finding id
 * @returns 202 `{ status: 'building' }` on success, 404 if finding not found
 */
export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id: findingId } = await context.params
  const db = getDb()

  const finding = getFindingById(db, findingId)
  if (!finding) {
    return NextResponse.json({ error: `Finding ${findingId} not found` }, { status: 404 })
  }

  // Resolve the repository path from finding → scan → project
  const scan = getScanById(db, finding.scanId)
  const project = scan ? getProjectById(db, scan.projectId) : undefined
  const repoPath = project?.sourceRef ?? '.'

  // Fire-and-forget: build timeline asynchronously
  buildTimeline(findingId, repoPath).catch(() => {
    // Errors are swallowed at this level — they will be visible in the
    // database row when the client polls GET /timeline (partial=true or no row)
  })

  return NextResponse.json({ status: 'building' }, { status: 202 })
}

// ---------------------------------------------------------------------------
// GET /api/findings/[id]/timeline
// ---------------------------------------------------------------------------

/**
 * Returns the timeline for a finding.
 *
 * If the timeline has not been computed yet, returns 202 `{ status: 'pending' }`.
 * Otherwise returns the full {@link TimelineResponse} with a pre-filled rotation draft.
 *
 * @param _req - Incoming GET request
 * @param context - Next.js route context with finding id
 * @returns 200 with TimelineResponse, 202 if pending, or 404 if finding not found
 */
export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id: findingId } = await context.params
  const db = getDb()

  // Verify the finding exists
  const finding = getFindingById(db, findingId)
  if (!finding) {
    return NextResponse.json({ error: `Finding ${findingId} not found` }, { status: 404 })
  }

  const timeline = findTimelineByFindingId(db, findingId)
  if (!timeline) {
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }

  const rotationDraft = buildRotationDraft(findingId, timeline.commits)

  const response: TimelineResponse = {
    findingId,
    commits: timeline.commits,
    suspectedDeploys: timeline.suspectedDeploys,
    partial: timeline.partial,
    computedAt: timeline.computedAt,
    rotationDraft,
  }

  return NextResponse.json(response, { status: 200 })
}
