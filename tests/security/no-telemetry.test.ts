/**
 * tests/security/no-telemetry.test.ts
 *
 * Static analysis test: verifies no outbound telemetry calls or analytics
 * keywords exist in the production source code.
 *
 * RED phase: This test asserts there are ZERO telemetry patterns.
 * If any exist, the test fails → we identify and remove them.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const SRC_DIRS = ['lib', 'app', 'bin', 'components']
const EXCLUDE_DIRS = ['.git', 'node_modules', '.next', '.tmp', 'dist', 'coverage', 'drizzle', '.obt']

// Patterns that indicate outbound network calls
const NETWORK_PATTERNS = [
  'fetch(',
  'http.request',
  'https.request',
  'XMLHttpRequest',
]

// Telemetry/analytics vendor keywords
const TELEMETRY_KEYWORDS = [
  'telemetry',
  'analytics',
  'tracking',
  'segment',
  'amplitude',
  'mixpanel',
  'sentry',
  'datadog',
  'posthog',
  'newrelic',
  'logrocket',
  'fullstory',
  'hotjar',
  'rollbar',
  'bugsnag',
  'appcenter',
  'firebase-analytics',
  'gtag',
  'gtm',
  'plausible',
  'fathom',
  'heap',
  'pendo',
  'split.io',
  'launchdarkly',
]

// Lines containing these substrings are NOT telemetry (false positives)
const ALLOWLIST_PATTERNS = [
  'no telemetry',            // "no telemetry" is the opposite
  'without telemetry',       // same sentiment
  'tracking-tight',          // Tailwind CSS utility class
  'tracking-wider',          // Tailwind CSS utility class
  'tracking-normal',         // Tailwind CSS utility class
  'migrations tracking',     // DB migration tracking table
  'tracking table',          // DB terminology
  'url segment',             // URL path segments, not analytics
  'last segment',            // URL path extraction, not analytics
  'path segment',            // Not analytics segment
  'extract last segment',    // URL parsing
  'single segment',          // Glob pattern matching — "within a single segment"
]

// Legitimate outbound security data API endpoints (not telemetry).
// These are read-only data sources used for CVE enrichment.
const SECURITY_DATA_ALLOWLIST = [
  'api.first.org',    // FIRST EPSS API — CVSS/EPSS scores for CVE enrichment
  'www.cisa.gov',     // CISA KEV catalog — US govt list of exploited vulnerabilities
  'api.osv.dev',      // OSV.dev — open source vulnerability database (used in v0.3+)
]

function shouldSkip(filePath: string): boolean {
  const relative = path.relative(PROJECT_ROOT, filePath)
  for (const exclude of EXCLUDE_DIRS) {
    if (relative.startsWith(exclude + path.sep) || relative === exclude) {
      return true
    }
  }
  // Only check TypeScript files (not compiled JS)
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return true
  }
  // Skip test files (this test file itself is excluded)
  if (relative.includes('/tests/') || relative.includes('\\tests\\')) {
    return true
  }
  return false
}

function collectSourceFiles(): string[] {
  const files: string[] = []

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue
        walk(fullPath)
      } else if (entry.isFile()) {
        if (!shouldSkip(fullPath)) {
          files.push(fullPath)
        }
      }
    }
  }

  for (const dir of SRC_DIRS) {
    const full = path.join(PROJECT_ROOT, dir)
    if (fs.existsSync(full)) {
      walk(full)
    }
  }

  return files
}

describe('No Telemetry Policy', () => {
  const sourceFiles = collectSourceFiles()

  it('has source files to scan', () => {
    // Basic sanity: there should be source files in the project
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  describe('outbound network calls', () => {
    for (const pattern of NETWORK_PATTERNS) {
      it(`no production source uses "${pattern}" for outbound telemetry`, () => {
        const violations: string[] = []

        for (const file of sourceFiles) {
          try {
            const content = fs.readFileSync(file, 'utf-8')
            // Check for the pattern in non-comment lines
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim()
              // Skip comments
              if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
              if (line.includes(pattern)) {
                // For fetch(), allow if targeting localhost or local file
                if (pattern === 'fetch(') {
                  if (line.includes('localhost') ||
                      line.includes('127.0.0.1') ||
                      line.includes('process.env') ||
                      line.includes('api/') ||
                      line.includes('/api/') ||
                      line.includes('NEXT_PUBLIC') ||
                      line.includes('OBT_')) {
                    continue // Legitimate API call, not telemetry
                  }
                  // Allow fetch calls annotated as legitimate security data sources.
                  // Enrichment modules (epss.ts, kev.ts) mark their network calls with
                  // the `// security-data-fetch` comment to declare intent explicitly.
                  if (line.includes('// security-data-fetch')) continue
                  // Allow fetch calls annotated as user-configured webhook delivery.
                  // Notification modules use `// user-webhook-fetch` to declare intent.
                  if (line.includes('// user-webhook-fetch')) continue
                  // Allow fetch calls annotated as GitHub API calls (authenticated, not telemetry).
                  // GitHub integration modules use `// github-api-fetch` to declare intent.
                  if (line.includes('// github-api-fetch')) continue
                  // Allow fetch calls to known security data hostnames directly in the line
                  const isSecurityDataSource = SECURITY_DATA_ALLOWLIST.some((host) =>
                    line.includes(host),
                  )
                  if (isSecurityDataSource) continue
                }
                violations.push(`${file}:${i + 1}: ${line.trim()}`)
              }
            }
          } catch {
            // Skip files that can't be read
          }
        }

        expect(violations).toEqual([])
      })
    }
  })

  describe('analytics/telemetry keywords', () => {
    // Test each keyword individually for clear failure messages
    for (const keyword of TELEMETRY_KEYWORDS) {
      it(`no source file contains "${keyword}"`, () => {
        const violations: string[] = []

        // Build a regex that matches the keyword as a whole word or dashed identifier
        // This prevents false positives like "BusEntry" matching "sentry"
        const wordBoundaryRegex = new RegExp(
          `(?:^|[^a-zA-Z0-9_-])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-zA-Z0-9_-]|$)`,
          'i',
        )

        for (const file of sourceFiles) {
          try {
            const content = fs.readFileSync(file, 'utf-8')
            const lowerContent = content.toLowerCase()

            // Quick check: does the keyword appear at all?
            const lowerKeyword = keyword.toLowerCase()
            if (!lowerContent.includes(lowerKeyword)) continue

            // Word boundary match to filter out substring false positives
            if (!wordBoundaryRegex.test(content)) continue

            // Find the specific lines that match
            const lines = content.split('\n')
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              const lowerLine = line.toLowerCase()

              if (!lowerLine.includes(lowerKeyword)) continue
              if (!wordBoundaryRegex.test(line)) continue

              // Skip lines referencing this test file
              if (line.includes('no-telemetry')) continue

              // Skip allowlisted patterns
              const isAllowlisted = ALLOWLIST_PATTERNS.some((pattern) =>
                lowerLine.includes(pattern.toLowerCase()),
              )
              if (isAllowlisted) continue

              violations.push(`${file}:${i + 1}: ${line.trim()}`)
            }
          } catch {
            // Skip files that can't be read
          }
        }

        expect(violations).toEqual([])
      })
    }
  })

  it('no external HTTP libraries are imported for telemetry', () => {
    const importPatterns = [
      /import.*['"]axios['"]/,
      /import.*['"]got['"]/,
      /import.*['"]node-fetch['"]/,
      /import.*['"]undici['"]/,
      /import.*['"]@sentry/,
      /import.*['"]@datadog/,
      /import.*['"]posthog/,
    ]

    const violations: string[] = []

    for (const file of sourceFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        for (const pattern of importPatterns) {
          if (pattern.test(content)) {
            violations.push(`${file}: imports ${pattern.source}`)
          }
        }
      } catch {
        // Skip
      }
    }

    expect(violations).toEqual([])
  })
})
