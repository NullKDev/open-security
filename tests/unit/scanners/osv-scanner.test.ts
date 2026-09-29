import { describe, it, expect, vi } from 'vitest'
import type { ScannerSpawnResult, ResolveCheckFn } from '@/lib/scanners/types'

async function* stringIterable(s: string): AsyncIterable<string> {
  yield s
}

function fakeSpawn(stdoutJson: unknown): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(JSON.stringify(stdoutJson)),
    stderr: stringIterable(''),
    exited: Promise.resolve({ code: 0, signal: null }),
  })
}

function fakeSpawnError(stderrMsg: string): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(''),
    stderr: stringIterable(stderrMsg),
    exited: Promise.resolve({ code: 1, signal: null }),
  })
}

describe('scanOsvScanner', () => {
  it('returns status skipped when osv-scanner binary is not found', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')
    const check: ResolveCheckFn = vi.fn(() => false)

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check })

    expect(check).toHaveBeenCalledWith('osv-scanner')
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('binary not found')
    }
  })

  it('normalises osv-scanner JSON output with CVSS scores to canonical findings', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')

    const osvFixture = {
      results: [
        {
          source: { path: 'package-lock.json', type: 'lockfile' },
          packages: [
            {
              package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
              vulnerabilities: [
                {
                  id: 'GHSA-x5rq-j2xg-h7qm',
                  summary: 'Prototype Pollution in lodash',
                  details: 'lodash versions prior to 4.17.21 are vulnerable...',
                  severity: [
                    { type: 'CVSS_V3', score: '9.8' },
                  ],
                  aliases: ['CVE-2020-8203'],
                },
              ],
            },
          ],
        },
        {
          source: { path: 'requirements.txt', type: 'lockfile' },
          packages: [
            {
              package: { name: 'django', version: '3.2.0', ecosystem: 'PyPI' },
              vulnerabilities: [
                {
                  id: 'GHSA-q2x5-w3f6-abc',
                  summary: 'SQL Injection in Django',
                  details: 'A flaw in the ORM allows...',
                  severity: [
                    { type: 'CVSS_V3', score: '6.5' },
                  ],
                  aliases: [],
                },
              ],
            },
          ],
        },
      ],
    }

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(osvFixture)

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(2)

    const [f1, f2] = result.findings

    // CVSS 9.8 → critical (9.0-10.0)
    expect(f1.title).toBe('GHSA-x5rq-j2xg-h7qm')
    expect(f1.description).toBe('Prototype Pollution in lodash')
    expect(f1.severity).toBe('critical')
    expect(f1.locationPath).toBe('lodash@4.17.15')
    expect(f1.locationLineStart).toBe(0)
    expect(f1.detector).toBe('osv-scanner')

    // CVSS 6.5 → medium (4.0-6.9)
    expect(f2.title).toBe('GHSA-q2x5-w3f6-abc')
    expect(f2.description).toBe('SQL Injection in Django')
    expect(f2.severity).toBe('medium')
    expect(f2.locationPath).toBe('django@3.2.0')
  })

  it('maps all CVSS score ranges to correct severity levels', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')

    const osvFixture = {
      results: [
        {
          source: { path: 'pom.xml', type: 'lockfile' },
          packages: [
            {
              package: { name: 'critical-lib', version: '1.0', ecosystem: 'Maven' },
              vulnerabilities: [
                { id: 'CRIT-001', summary: 'Critical vuln', severity: [{ type: 'CVSS_V3', score: '10.0' }] },
              ],
            },
            {
              package: { name: 'high-lib', version: '1.0', ecosystem: 'Maven' },
              vulnerabilities: [
                { id: 'HIGH-001', summary: 'High vuln', severity: [{ type: 'CVSS_V3', score: '8.5' }] },
              ],
            },
            {
              package: { name: 'medium-lib', version: '1.0', ecosystem: 'Maven' },
              vulnerabilities: [
                { id: 'MED-001', summary: 'Medium vuln', severity: [{ type: 'CVSS_V3', score: '5.0' }] },
              ],
            },
            {
              package: { name: 'low-lib', version: '1.0', ecosystem: 'Maven' },
              vulnerabilities: [
                { id: 'LOW-001', summary: 'Low vuln', severity: [{ type: 'CVSS_V3', score: '2.0' }] },
              ],
            },
            {
              package: { name: 'info-lib', version: '1.0', ecosystem: 'Maven' },
              vulnerabilities: [
                { id: 'INFO-001', summary: 'Info vuln', severity: [{ type: 'CVSS_V3', score: '0.0' }] },
              ],
            },
          ],
        },
      ],
    }

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(osvFixture)

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check, spawn })

    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(5)

    const severities = result.findings.map((f) => f.severity)
    expect(severities).toEqual(['critical', 'high', 'medium', 'low', 'info'])
  })

  it('handles vulnerability without CVSS score (defaults to medium)', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')

    const osvFixture = {
      results: [
        {
          source: { path: 'go.mod', type: 'lockfile' },
          packages: [
            {
              package: { name: 'some-lib', version: '0.1.0', ecosystem: 'Go' },
              vulnerabilities: [
                {
                  id: 'GO-2025-0001',
                  summary: 'Unrated vulnerability',
                  severity: [],
                },
              ],
            },
          ],
        },
      ],
    }

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(osvFixture)

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check, spawn })

    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings[0].severity).toBe('medium')
  })

  it('handles empty results array', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn({ results: [] })

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })

  it('returns status error when osv-scanner exits with non-zero code', async () => {
    const { scanOsvScanner } = await import('@/lib/scanners/osv-scanner')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawnError('osv-scanner: database fetch failed')

    const result = await scanOsvScanner('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.reason).toContain('osv-scanner exited with code 1')
  })
})
