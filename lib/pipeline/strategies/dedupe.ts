import type { NormalizedFinding } from '@/lib/scanners/types'

/**
 * Deduplication key: "<locationPath>:<locationLineStart>:<lowercased trimmed title>"
 * First occurrence wins — preserves the earlier domain finding.
 */
export function dedupeKey(f: NormalizedFinding): string {
  return `${f.locationPath}:${f.locationLineStart}:${f.title.trim().toLowerCase()}`
}

/** Remove duplicate findings using dedupeKey. First occurrence wins. */
export function dedupeFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const seen = new Map<string, NormalizedFinding>()
  for (const f of findings) {
    const k = dedupeKey(f)
    if (!seen.has(k)) seen.set(k, f)
  }
  return Array.from(seen.values())
}
