// SARIF 2.1.0 report generator

export interface SarifFinding {
  id: string
  detector: string
  severity: string
  confidence: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number | null
}

type SarifLevel = 'error' | 'warning' | 'note' | 'none'

function severityToLevel(severity: string): SarifLevel {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
    case 'info':
      return 'note'
    default:
      return 'none'
  }
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId: string }
    region: { startLine: number; endLine?: number }
  }
}

interface SarifResult {
  ruleId: string
  level: SarifLevel
  message: { text: string }
  locations: SarifLocation[]
}

interface SarifRun {
  tool: {
    driver: {
      name: string
      version?: string
      informationUri: string
    }
  }
  results: SarifResult[]
}

interface SarifOutput {
  $schema: string
  version: '2.1.0'
  runs: SarifRun[]
}

export function generateSarifReport(
  findings: SarifFinding[],
  toolVersion?: string,
): string {
  const results: SarifResult[] = findings.map((finding) => ({
    ruleId: finding.detector,
    level: severityToLevel(finding.severity),
    message: {
      text: `${finding.title}: ${finding.description}`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: finding.locationPath,
            uriBaseId: '%SRCROOT%',
          },
          region: {
            startLine: finding.locationLineStart,
            ...(finding.locationLineEnd != null && finding.locationLineEnd !== finding.locationLineStart
              ? { endLine: finding.locationLineEnd }
              : {}),
          },
        },
      },
    ],
  }))

  const driver: SarifRun['tool']['driver'] = {
    name: 'open-security',
    informationUri: 'https://github.com/open-security/open-security',
    ...(toolVersion != null ? { version: toolVersion } : {}),
  }

  const output: SarifOutput = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver },
        results,
      },
    ],
  }

  return JSON.stringify(output, null, 2)
}
