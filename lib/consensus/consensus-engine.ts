/**
 * lib/consensus/consensus-engine.ts
 *
 * Cross-scanner consensus computation for v1.0.
 *
 * Algorithm (ADR-3):
 *   1. Group findings by dedupKey
 *   2. For each group, look up which scanners ran on that file (from the manifest)
 *   3. Score = |agreeing detectors| / |candidates|
 *   4. Status:
 *      - |candidates| <= 1 → 'single-source'
 *      - |agreeing| == |candidates| → 'agree'
 *      - otherwise → 'conflicted'
 *
 * Errored scanners are EXCLUDED from candidates (manifest only contains successful runs).
 * Computed at scan completion (Stage 4), before persistence.
 */
import type { NormalizedFinding } from '@/lib/scanners/types'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Maps file paths to the list of scanner/detector names that ran successfully on them.
 * Errored scanners should NOT be included — they are excluded from consensus.
 */
export type ScannersManifest = Record<string, string[]>

/** Vote record per scanner/detector for a given finding group */
export interface ScannerVote {
  detector: string
  vote: 'flagged' | 'silent'
}

/** A finding augmented with consensus score, status, and votes */
export interface ScoredFinding extends NormalizedFinding {
  /** Fraction of scanners that agreed on this finding (0.0–1.0) */
  consensusScore: number
  /** 'single-source' | 'agree' | 'conflicted' */
  consensusStatus: 'single-source' | 'agree' | 'conflicted'
  /** JSON-serialized ScannerVote[] */
  scannerVotes: string
  /** The dedup key this finding was grouped by */
  dedupKey: string
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Compute consensus scores for a list of findings using the scanner manifest.
 *
 * Groups findings by `dedupKey`. For each group, determines which scanners
 * ran on the file (from `scannersManifest`) and computes the agreement score.
 *
 * @param findings - Findings with a `dedupKey` property (passed from Stage 1)
 * @param scannersManifest - Maps file path → list of detectors that ran (no errors)
 * @returns Same findings annotated with consensusScore, consensusStatus, scannerVotes
 */
export function computeConsensus(
  findings: Array<NormalizedFinding & { dedupKey?: string }>,
  scannersManifest: ScannersManifest,
): ScoredFinding[] {
  if (findings.length === 0) return []

  // ── Group by dedupKey ───────────────────────────────────────────────────────
  const groups = new Map<string, Array<NormalizedFinding & { dedupKey?: string }>>()

  for (const finding of findings) {
    const key = finding.dedupKey ?? `${finding.detector}:${finding.locationPath}:${finding.title}`
    const group = groups.get(key)
    if (group) {
      group.push(finding)
    } else {
      groups.set(key, [finding])
    }
  }

  // ── Score each group ────────────────────────────────────────────────────────
  const result: ScoredFinding[] = []

  for (const [dedupKey, group] of groups) {
    const filePath = group[0].locationPath

    // Candidates = scanners that ran on this file (errored excluded by manifest design)
    const candidates: string[] = scannersManifest[filePath] ?? []

    // Agreeing = unique detectors that flagged this dedupKey
    const agreeing = new Set(group.map((f) => f.detector))

    let consensusScore: number
    let consensusStatus: 'single-source' | 'agree' | 'conflicted'

    if (candidates.length <= 1) {
      // Only one scanner ran (or no manifest entry) → single-source
      consensusScore = 1.0
      consensusStatus = 'single-source'
    } else {
      consensusScore = agreeing.size / candidates.length
      if (agreeing.size === candidates.length) {
        consensusStatus = 'agree'
      } else {
        consensusStatus = 'conflicted'
      }
    }

    // Build per-scanner vote records
    const voteList: ScannerVote[] = candidates.map((detector) => ({
      detector,
      vote: agreeing.has(detector) ? 'flagged' : 'silent',
    }))

    // If no manifest candidates but finding exists, record it as flagged
    if (candidates.length === 0) {
      for (const detector of agreeing) {
        voteList.push({ detector, vote: 'flagged' })
      }
    }

    const scannerVotesJson = JSON.stringify(voteList)

    // Annotate all findings in this group
    for (const finding of group) {
      result.push({
        ...finding,
        dedupKey,
        consensusScore,
        consensusStatus,
        scannerVotes: scannerVotesJson,
      })
    }
  }

  return result
}
