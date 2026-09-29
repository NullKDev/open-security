/**
 * lib/exporters/finding-shape.ts
 *
 * Pure adapter: maps a FindingDTO to a canonical export shape.
 * No DB access — stateless transformation only.
 *
 * Used by all exporters (Jira, Slack, SARIF, CSV) to produce a consistent
 * representation of a finding that survives serialization.
 */
import type { FindingDTO } from '@/lib/repos/findings.repo'

/**
 * Canonical export representation of a finding.
 * All fields are serialization-safe (no class instances, no undefined).
 */
export interface FindingExportShape {
  id: string
  scanId: string
  detector: string
  severity: string
  confidence: number
  exploitability: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd: number | null
  locationCommit: string | null
  dataFlow: unknown | null
  evidenceHistory: unknown | null
  patchDiff: string | null
  patchExplanation: string | null
  patchContext: string | null
  patchGeneratedAt: string | null
  validationModel: string | null
  validationPasses: boolean | null
  validationRationale: string | null
  fpFiltered: boolean
  tags: unknown | null
  createdAt: string
  dedupKey: string | null
  canonicalFindingId: string | null
  cveIds: string[] | null
  firstDetectedAt: string | null
  lastSeenAt: string | null
  occurrenceCount: number
  status: string | null
  proofOfFixId: string | null
  isRegression: boolean
  regressionOfFindingId: string | null
}

/**
 * Map a FindingDTO to the canonical export shape.
 *
 * Performs no DB access. Null-safe for all optional fields.
 * The returned object is a plain serialization-safe copy.
 *
 * @param finding - The FindingDTO from the repository layer
 * @returns Canonical FindingExportShape suitable for all exporters
 */
export function toExportShape(finding: FindingDTO): FindingExportShape {
  return {
    id: finding.id,
    scanId: finding.scanId,
    detector: finding.detector,
    severity: finding.severity,
    confidence: finding.confidence,
    exploitability: finding.exploitability,
    title: finding.title,
    description: finding.description,
    locationPath: finding.locationPath,
    locationLineStart: finding.locationLineStart,
    locationLineEnd: finding.locationLineEnd ?? null,
    locationCommit: finding.locationCommit ?? null,
    dataFlow: finding.dataFlow ?? null,
    evidenceHistory: finding.evidenceHistory ?? null,
    patchDiff: finding.patchDiff ?? null,
    patchExplanation: finding.patchExplanation ?? null,
    patchContext: finding.patchContext ?? null,
    patchGeneratedAt: finding.patchGeneratedAt ?? null,
    validationModel: finding.validationModel ?? null,
    validationPasses: finding.validationPasses ?? null,
    validationRationale: finding.validationRationale ?? null,
    fpFiltered: finding.fpFiltered,
    tags: finding.tags ?? null,
    createdAt: finding.createdAt,
    dedupKey: finding.dedupKey ?? null,
    canonicalFindingId: finding.canonicalFindingId ?? null,
    cveIds: finding.cveIds ?? null,
    firstDetectedAt: finding.firstDetectedAt ?? null,
    lastSeenAt: finding.lastSeenAt ?? null,
    occurrenceCount: finding.occurrenceCount,
    status: finding.status ?? null,
    proofOfFixId: finding.proofOfFixId ?? null,
    isRegression: finding.isRegression,
    regressionOfFindingId: finding.regressionOfFindingId ?? null,
  }
}
