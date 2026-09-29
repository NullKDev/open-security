/**
 * Pure formatting utilities for the queue UI layer.
 * These are intentionally side-effect free so they can be unit-tested
 * without rendering any components.
 */

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  high: 'text-orange-600 bg-orange-50 border-orange-200',
  medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  low: 'text-blue-600 bg-blue-50 border-blue-200',
  info: 'text-gray-600 bg-gray-50 border-gray-200',
}

/**
 * Returns a Tailwind class string appropriate for a given finding severity.
 * Falls back to gray for any unrecognized value.
 */
export function severityColorClass(severity: string): string {
  return SEVERITY_COLOR[severity.toLowerCase()] ?? SEVERITY_COLOR['info']
}

/**
 * Capitalizes the first letter of a severity string.
 * Returns the string unchanged if it is empty.
 */
export function severityLabel(severity: string): string {
  if (!severity) return severity
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

/**
 * Formats an EPSS score (0–1 float) as a human-readable percentage string.
 * Returns "N/A" when the score is null or undefined.
 *
 * @param score - EPSS probability of exploitation in the next 30 days (0–1)
 */
export function formatEpss(score: number | null | undefined): string {
  if (score == null) return 'N/A'
  return `${(score * 100).toFixed(2)}%`
}

/**
 * Formats an ISO-8601 date string as a human-friendly age string.
 * Returns "unknown" when the value is null or undefined.
 *
 * @param iso - ISO-8601 timestamp string or null/undefined
 */
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const msAgo = Date.now() - new Date(iso).getTime()
  const daysAgo = Math.floor(msAgo / (1000 * 60 * 60 * 24))
  if (daysAgo === 0) return 'today'
  if (daysAgo === 1) return '1 day ago'
  return `${daysAgo} days ago`
}
