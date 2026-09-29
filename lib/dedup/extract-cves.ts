/**
 * extract-cves.ts — Extract CVE IDs from finding title/description
 *
 * Only extracts for the 'osv' detector since OSV findings are vulnerability
 * advisories that carry CVE identifiers. Other detectors (semgrep, gitleaks, etc.)
 * don't embed CVE IDs in their findings.
 */

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/g

/**
 * Extracts CVE IDs from a finding's title and description.
 *
 * Only applies when `detector === 'osv'`. Returns an empty array for all
 * other detectors. CVE IDs are deduplicated and returned in match order.
 *
 * @param detector - The scanner that produced the finding
 * @param title - Finding title (always present)
 * @param description - Finding description (may be undefined/empty)
 * @returns Deduplicated array of CVE ID strings (e.g. ['CVE-2024-1234'])
 */
export function extractCves(
  detector: string,
  title: string,
  description: string | undefined,
): string[] {
  if (detector !== 'osv') return []

  const combined = `${title} ${description ?? ''}`
  const matches = combined.match(CVE_PATTERN) ?? []

  return [...new Set(matches)]
}
