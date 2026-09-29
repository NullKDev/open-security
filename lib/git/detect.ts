import type { CommitInfo } from './history-walker'
import type { AuthorStatsEntry } from './author-stats'
import type { DetectorFinding } from '@/lib/detectors/types'

// ── Injectable gitleaks runner type ───────────────────────────
/** Result shape from running gitleaks against a path. Injectable for testing. */
export type GitleaksRunFn = (repoPath: string) => GitleaksRunResult

export interface GitleaksRunResult {
  status: 'completed' | 'skipped' | 'error'
  findings?: Array<{
    title: string
    description: string
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
    locationPath: string
    locationLineStart: number
    locationLineEnd?: number
    detector: string
  }>
  reason?: string
}

export interface SecretDetectOpts {
  runGitleaks?: GitleaksRunFn
}

// ── Suspicious commit keywords (case-insensitive) ──────────────
const SUSPICIOUS_KEYWORDS = [
  /\bfix\s*typo\b/i,
  /\bWIP\b/,
  /\bwork\s*in\s*progress\b/i,
  /\bdebug\b/i,
  /\bdebugging\b/i,
  /\btest\b.*\bcred\b/i,
  /\bremove\s*(?:creds?|credentials?|secrets?|keys?|tokens?)\b/i,
  /\btemp\b/i,
  /\btemporary\b/i,
  /\boops\b/i,
  /\bwhoops\b/i,
]

const LARGE_DIFF_THRESHOLD = 10000
const VALID_TZ_MIN = -12 // UTC-12
const VALID_TZ_MAX = 14  // UTC+14

// ── SKILL.md reader ────────────────────────────────────────────
/** Inline minimal SKILL.md metadata for each detector.
 *  In production this would read from the filesystem. */
const SKILL_META: Record<string, { id: string; severity: string; description: string }> = {
  'secret-in-history': {
    id: 'secret-in-history',
    severity: 'critical',
    description: 'Detects secrets (API keys, tokens, passwords) leaked in git commit history.',
  },
  'suspicious-commit': {
    id: 'suspicious-commit',
    severity: 'medium',
    description: 'Detects suspicious commit patterns that may indicate security-relevant activity.',
  },
  'author-anomaly': {
    id: 'author-anomaly',
    severity: 'low',
    description: 'Detects anomalous author patterns in git history.',
  },
}

// ── Helper: extract timezone offset from ISO date ─────────────
function extractTzOffset(dateStr: string): number {
  // Match ISO 8601 timezone: ±HH:MM
  const tzMatch = dateStr.match(/([+-]\d{2}):(\d{2})$/)
  if (!tzMatch) return 0 // UTC/Z
  const hours = parseInt(tzMatch[1], 10)
  const mins = parseInt(tzMatch[2], 10)
  return hours + (hours >= 0 ? mins : -mins) / 60
}

// ── Detector 1: Secret-in-History ──────────────────────────────

/**
 * Detect secrets committed in git history by running gitleaks
 * against each commit that introduced file changes.
 *
 * Skips commits with no file changes (empty commits).
 * Uses injectable `runGitleaks` for testing.
 *
 * @param repoPath  - Path to the repository
 * @param commits   - CommitInfo entries from the history walker
 * @param opts      - Options including injectable gitleaks runner
 * @returns Array of findings with detector id "secret-in-history"
 */
export async function detectSecretsInHistory(
  repoPath: string,
  commits: CommitInfo[],
  opts?: SecretDetectOpts,
): Promise<DetectorFinding[]> {
  const runGitleaks = opts?.runGitleaks
  if (!runGitleaks) return [] // No scanner available

  const findings: DetectorFinding[] = []

  for (const commit of commits) {
    // Skip commits with no file changes
    if (commit.filesChanged === 0 && commit.insertions === 0 && commit.deletions === 0) {
      continue
    }

    const result = runGitleaks(repoPath)

    if (result.status !== 'completed' || !result.findings) continue

    for (const f of result.findings) {
      findings.push({
        detector: 'secret-in-history',
        severity: f.severity,
        title: f.title,
        description: f.description,
        locationPath: f.locationPath,
        locationLineStart: f.locationLineStart,
        locationLineEnd: f.locationLineEnd,
        locationCommit: commit.hash,
        locationAuthor: commit.author,
      })
    }
  }

  return findings
}

// ── Detector 2: Suspicious-commit ──────────────────────────────

/**
 * Detect suspicious commit patterns:
 * - Keywords: "fix typo", "WIP", "debug", "test cred", "remove creds", etc.
 * - Large diff: > 10,000 insertions in a single commit
 * - Unusual timezone: outside UTC-12 to UTC+14 range
 *
 * @param commits - CommitInfo entries from the history walker
 * @returns Array of findings with detector id "suspicious-commit"
 */
export function detectSuspiciousCommits(
  commits: CommitInfo[],
): DetectorFinding[] {
  const findings: DetectorFinding[] = []

  for (const commit of commits) {
    let reasons: string[] = []

    // 1. Check for suspicious keywords in message
    for (const pattern of SUSPICIOUS_KEYWORDS) {
      if (pattern.test(commit.message)) {
        const match = commit.message.match(pattern)?.[0] ?? 'match'
        reasons.push(`Suspicious keyword in message: "${match}"`)
        break // One keyword finding per commit
      }
    }

    // 2. Check large diff
    if (commit.insertions > LARGE_DIFF_THRESHOLD) {
      reasons.push(
        `Large diff: ${commit.insertions} insertions across ${commit.filesChanged} files`,
      )
    }

    // 3. Check unusual timezone
    const tzOffset = extractTzOffset(commit.date)
    if (tzOffset < VALID_TZ_MIN || tzOffset > VALID_TZ_MAX) {
      reasons.push(
        `Unusual timezone: UTC${tzOffset >= 0 ? '+' : ''}${tzOffset} (valid range: ${VALID_TZ_MIN} to ${VALID_TZ_MAX})`,
      )
    }

    // Create one finding per reason
    for (const reason of reasons) {
      const title = reason.startsWith('Suspicious keyword')
        ? 'Suspicious commit message'
        : reason.startsWith('Large diff')
          ? 'Large diff in single commit'
          : 'Unusual timezone in commit'

      findings.push({
        detector: 'suspicious-commit',
        severity: 'medium',
        title,
        description: `${reason}. Commit: ${commit.hash.substring(0, 7)} by ${commit.author}`,
        locationPath: '', // Not file-specific
        locationLineStart: 0,
        locationCommit: commit.hash,
        locationAuthor: commit.author,
      })
    }
  }

  return findings
}

// ── Detector 3: Author-anomaly ─────────────────────────────────

/**
 * Detect author anomalies:
 * - Single-commit authors (potential sock puppets)
 * - Domain outliers (email domain differs from majority)
 * - Name/email mismatch (author name not reflected in email)
 *
 * @param authors - Aggregated author stats
 * @param scanId  - Scan identifier for the finding context
 * @returns Array of findings with detector id "author-anomaly"
 */
export function detectAuthorAnomalies(
  authors: AuthorStatsEntry[],
  scanId: string,
): DetectorFinding[] {
  if (authors.length === 0) return []

  const findings: DetectorFinding[] = []

  // Determine majority domain
  const domainCounts = new Map<string, number>()
  for (const a of authors) {
    const domain = a.email.split('@')[1] || 'unknown'
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
  }
  let majorityDomain = ''
  let maxCount = 0
  for (const [domain, count] of domainCounts) {
    if (count > maxCount) {
      maxCount = count
      majorityDomain = domain
    }
  }

  for (const author of authors) {
    // 1. Single-commit authors
    if (author.commitCount === 1) {
      findings.push({
        detector: 'author-anomaly',
        severity: 'low',
        title: 'Single-commit author',
        description: `Author ${author.email} (${author.name ?? 'unknown'}) has only 1 commit in the repository. This may be a sock-puppet account or test account.`,
        locationPath: '',
        locationLineStart: 0,
        locationAuthor: author.email,
      })
    }

    // 2. Domain outliers (only flag if there are 3+ authors and a clear majority exists)
    if (authors.length >= 3 && majorityDomain) {
      const authorDomain = author.email.split('@')[1] || 'unknown'
      if (authorDomain !== majorityDomain && domainCounts.get(authorDomain) === 1) {
        findings.push({
          detector: 'author-anomaly',
          severity: 'info',
          title: 'Author with outlier email domain',
          description: `Author ${author.email} uses domain "${authorDomain}" while majority (${maxCount}/${authors.length}) uses "${majorityDomain}".`,
          locationPath: '',
          locationLineStart: 0,
          locationAuthor: author.email,
        })
      }
    }

    // 3. Name/email mismatch
    if (author.name) {
      const nameLower = author.name.toLowerCase()
      const emailLocal = author.email.split('@')[0].toLowerCase()
      const nameParts = nameLower.split(/\s+/)

      // Check if any meaningful part of the name appears in the email local part.
      // Both the name part AND the email local part must be >= 3 chars for a valid match.
      const anyNamePartInEmail = nameParts.some((part) => {
        if (part.length < 3) return false // Skip initials/short names
        if (emailLocal.length < 3) return false // Email too short to match meaningfully
        return emailLocal.includes(part) || part.includes(emailLocal)
      })

      if (!anyNamePartInEmail && nameParts.length > 0) {
        findings.push({
          detector: 'author-anomaly',
          severity: 'info',
          title: 'Author name/email mismatch',
          description: `Author "${author.name}" has email ${author.email} — the name does not appear in the email address, which may indicate a generic or shared account.`,
          locationPath: '',
          locationLineStart: 0,
          locationAuthor: author.email,
        })
      }
    }
  }

  return findings
}
