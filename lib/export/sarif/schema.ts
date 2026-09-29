/**
 * lib/export/sarif/schema.ts
 *
 * TypeScript types for SARIF 2.1.0 output.
 * Minimal subset of the full SARIF spec — covers what open-security emits.
 *
 * Spec reference: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
 */

export interface SarifArtifactLocation {
  uri: string
  uriBaseId?: string
}

export interface SarifRegion {
  startLine?: number
  startColumn?: number
  endLine?: number
  endColumn?: number
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation
  region?: SarifRegion
}

export interface SarifLocation {
  physicalLocation?: SarifPhysicalLocation
}

export interface SarifMessage {
  text: string
}

export type SarifLevel = 'none' | 'note' | 'warning' | 'error'

export interface SarifResult {
  ruleId: string
  level: SarifLevel
  message: SarifMessage
  locations?: SarifLocation[]
  partialFingerprints?: Record<string, string>
  properties?: Record<string, unknown>
}

export interface SarifTool {
  driver: {
    name: string
    version?: string
    informationUri?: string
    rules?: SarifRule[]
  }
}

export interface SarifRule {
  id: string
  name?: string
  shortDescription?: SarifMessage
}

export interface SarifRun {
  tool: SarifTool
  results: SarifResult[]
}

export interface SarifLog {
  version: '2.1.0'
  $schema: string
  runs: SarifRun[]
}
