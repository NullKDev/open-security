/** Shared types for detector dispatch and findings */

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** Metadata parsed from a detector's SKILL.md frontmatter */
export interface DetectorMeta {
  id: string
  title?: string
  stages?: string[]
  severity: Severity
  description: string
  classical_prepass?: string
  classical_hint?: string
}

/** A detector finding — matches the canonical finding shape */
export interface DetectorFinding {
  detector: string
  severity: Severity
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number
  locationCommit?: string
  locationAuthor?: string
}
