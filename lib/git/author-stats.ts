import type { CommitInfo } from './history-walker'

/** Aggregated statistics for a single author (keyed by email) */
export interface AuthorStatsEntry {
  email: string
  name: string | null
  commitCount: number
  firstSeen: string
  lastSeen: string
  totalInsertions: number
  totalDeletions: number
  anomalyFlags: Record<string, boolean>
}

/**
 * Compute aggregated author statistics from a stream of commits.
 *
 * Groups by email, counts commits, tracks first/last seen dates,
 * totals insertions/deletions, and sets anomaly flags for:
 * - singleCommit: author has exactly 1 commit (potential sock puppet)
 *
 * @param commits - Async iterable of CommitInfo objects
 * @returns Array of AuthorStatsEntry, sorted by email
 */
export async function computeAuthorStats(
  commits: AsyncIterable<CommitInfo>,
): Promise<AuthorStatsEntry[]> {
  // Accumulator: email → stats and name history
  const map = new Map<
    string,
    {
      name: string | null
      latestDate: string
      commitCount: number
      firstSeen: string
      lastSeen: string
      totalInsertions: number
      totalDeletions: number
      names: Map<string, number>
      domains: Set<string>
    }
  >()

  for await (const c of commits) {
    const existing = map.get(c.authorEmail)
    const domain = c.authorEmail.split('@')[1] || 'unknown'

    if (!existing) {
      map.set(c.authorEmail, {
        name: c.author,
        latestDate: c.date,
        commitCount: 1,
        firstSeen: c.date,
        lastSeen: c.date,
        totalInsertions: c.insertions,
        totalDeletions: c.deletions,
        names: new Map([[c.author, 1]]),
        domains: new Set([domain]),
      })
      continue
    }

    existing.commitCount++
    existing.totalInsertions += c.insertions
    existing.totalDeletions += c.deletions

    // Track name frequencies
    existing.names.set(c.author, (existing.names.get(c.author) || 0) + 1)

    // Track domains
    existing.domains.add(domain)

    // Update first/last seen
    if (c.date < existing.firstSeen) {
      existing.firstSeen = c.date
      existing.name = c.author // earliest name
    }
    if (c.date > existing.lastSeen) {
      existing.lastSeen = c.date
      existing.latestDate = c.date
      existing.name = c.author // latest name
    }
  }

  // Build result with anomaly flags
  const result: AuthorStatsEntry[] = []
  for (const [email, acc] of map) {
    const anomalyFlags: Record<string, boolean> = {}

    if (acc.commitCount === 1) {
      anomalyFlags.singleCommit = true
    }

    if (acc.domains.size > 1) {
      anomalyFlags.multipleDomains = true
    }

    result.push({
      email,
      name: acc.name,
      commitCount: acc.commitCount,
      firstSeen: acc.firstSeen,
      lastSeen: acc.lastSeen,
      totalInsertions: acc.totalInsertions,
      totalDeletions: acc.totalDeletions,
      anomalyFlags,
    })
  }

  // Sort by email for deterministic output
  result.sort((a, b) => a.email.localeCompare(b.email))

  return result
}
