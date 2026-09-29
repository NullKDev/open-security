/**
 * lib/export/sarif/emit.ts
 *
 * Transform normalized findings into a SARIF 2.1.0 document.
 *
 * Design decisions:
 * - Dual fingerprints: obt/v0.1/dedupKey (exact reuse) + obt/sarif/primaryLocationLineHash
 *   (GitHub Security tab survives line-drift on moved-but-unchanged findings)
 * - Severity mapping: critical/high → error, medium → warning, low → note, info → none
 * - ruleId: "{detector}:{title}" (slugified, colon-separated)
 * - Properties carry obt/severity, obt/detector, obt/dedupKey, obt/scanId
 */

import crypto from 'node:crypto'
import type { SarifLog, SarifResult, SarifLevel, SarifRun, SarifRule } from './schema'

/** Minimal finding shape required by the emitter */
export interface FindingRow {
  id: string
  scanId: string
  detector: string
  severity: string
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number | null
  dedupKey?: string | null
}

/** Input to emitSarif */
export interface EmitSarifOpts {
  findings: FindingRow[]
  scanId: string
  toolName: string
  toolVersion?: string
}

const SARIF_SCHEMA_URL =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json'

/**
 * Map internal severity to SARIF level.
 * critical/high → error, medium → warning, low → note, info → none
 */
function toSarifLevel(severity: string): SarifLevel {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
      return 'note'
    default:
      return 'none'
  }
}

/**
 * Build a ruleId from detector and title.
 * Format: "{detector}:{slugified-title}"
 */
function toRuleId(detector: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${detector}:${slug}`
}

/**
 * Derive the SARIF primaryLocationLineHash fingerprint.
 * SHA-256 of "ruleId|uri|startLine" — survives line-drift in GitHub Security tab.
 */
function toPrimaryLocationLineHash(ruleId: string, uri: string, startLine: number): string {
  const input = `${ruleId}|${uri}|${startLine}`
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Transform normalized findings into a SARIF 2.1.0 JSON document.
 *
 * Emits dual partialFingerprints:
 *   - `obt/v0.1/dedupKey`: exact dedup_key for round-trip lossless matching
 *   - `obt/sarif/primaryLocationLineHash`: SHA-256 of ruleId|uri|startLine for GitHub Security tab
 *
 * @param opts.findings - Array of finding rows to include
 * @param opts.scanId - Scan identifier (included in properties)
 * @param opts.toolName - Tool name for the SARIF `tool.driver.name` field
 * @param opts.toolVersion - Optional version string
 * @returns SARIF 2.1.0 log document
 */
export function emitSarif(opts: EmitSarifOpts): SarifLog {
  const { findings, scanId, toolName, toolVersion } = opts

  const ruleMap = new Map<string, SarifRule>()
  const results: SarifResult[] = []

  for (const finding of findings) {
    const ruleId = toRuleId(finding.detector, finding.title)
    const level = toSarifLevel(finding.severity)
    const uri = finding.locationPath
    const startLine = finding.locationLineStart

    // Build or reuse rule definition
    if (!ruleMap.has(ruleId)) {
      ruleMap.set(ruleId, {
        id: ruleId,
        name: finding.title,
        shortDescription: { text: finding.title },
      })
    }

    // Build dual fingerprints
    const lineHash = toPrimaryLocationLineHash(ruleId, uri, startLine)
    const partialFingerprints: Record<string, string> = {
      'obt/sarif/primaryLocationLineHash': lineHash,
    }
    if (finding.dedupKey) {
      partialFingerprints['obt/v0.1/dedupKey'] = finding.dedupKey
    }

    const result: SarifResult = {
      ruleId,
      level,
      message: { text: finding.description || finding.title },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri, uriBaseId: '%SRCROOT%' },
            region: {
              startLine,
              ...(finding.locationLineEnd != null && { endLine: finding.locationLineEnd }),
            },
          },
        },
      ],
      partialFingerprints,
      properties: {
        'obt/severity': finding.severity,
        'obt/detector': finding.detector,
        'obt/scanId': scanId,
        ...(finding.dedupKey && { 'obt/dedupKey': finding.dedupKey }),
      },
    }

    results.push(result)
  }

  const run: SarifRun = {
    tool: {
      driver: {
        name: toolName,
        ...(toolVersion && { version: toolVersion }),
        informationUri: 'https://github.com/NearDev/open-security',
        rules: Array.from(ruleMap.values()),
      },
    },
    results,
  }

  return {
    version: '2.1.0',
    $schema: SARIF_SCHEMA_URL,
    runs: [run],
  }
}
