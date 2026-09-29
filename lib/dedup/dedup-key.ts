import { createHash } from 'node:crypto'

/**
 * Normalizes a string for dedup key computation:
 * lowercase, trim, collapse all internal whitespace to a single space.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Computes a stable SHA-256 dedup key for a finding.
 *
 * The key is derived from `normalize(detector) | normalize(locationPath) | normalize(title)`.
 * Line numbers are intentionally excluded so refactors that shift line numbers
 * do not create duplicate canonical entries for the same vulnerability.
 *
 * @param detector - The scanner that produced the finding (e.g. 'semgrep', 'gitleaks')
 * @param locationPath - File path where the finding was located
 * @param title - Finding title
 * @returns 64-character lowercase hex SHA-256 digest
 */
export function computeDedupKey(
  detector: string,
  locationPath: string,
  title: string,
): string {
  const raw = `${normalize(detector)}|${normalize(locationPath)}|${normalize(title)}`
  return createHash('sha256').update(raw, 'utf-8').digest('hex')
}
