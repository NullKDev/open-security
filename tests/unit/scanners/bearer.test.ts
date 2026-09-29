import { describe, it, expect, vi } from 'vitest'
import type { ScannerSpawnResult, ResolveCheckFn } from '@/lib/scanners/types'

// Helper: convert a string to an AsyncIterable
async function* stringIterable(s: string): AsyncIterable<string> {
  yield s
}

/** Build a fake spawn result — exits with the given code */
function fakeSpawn(stdoutJson: unknown, exitCode = 0): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(JSON.stringify(stdoutJson)),
    stderr: stringIterable(''),
    exited: Promise.resolve({ code: exitCode, signal: null }),
  })
}

/** Fake spawn that yields stderr and an error exit code */
function fakeSpawnError(stderrMsg: string, code = 2): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(''),
    stderr: stringIterable(stderrMsg),
    exited: Promise.resolve({ code, signal: null }),
  })
}

/** Minimal Bearer JSON output shape for a single finding */
const bearerFixture = {
  findings: [
    {
      id: 'bearer:ruby_lang_http_url_using_user_input',
      title: 'HTTP request with user-controlled URL',
      description: 'Identified a SSRF risk where user input flows into an HTTP request URL.',
      filename: 'src/api/fetch.ts',
      line_number: 42,
      severity: 'high',
      fingerprint: 'abc123',
    },
  ],
}

describe('scanBearer', () => {
  it('returns status skipped when bearer binary is not found', async () => {
    const { scanBearer } = await import('@/lib/scanners/bearer')
    const check: ResolveCheckFn = vi.fn(() => false)

    const result = await scanBearer('/tmp/repo', { resolveCheck: check })

    expect(check).toHaveBeenCalledWith('bearer')
    expect(result.status).toBe('skipped')
    expect('reason' in result && result.reason).toBe('binary not found')
  })

  it('normalizes bearer JSON output to canonical findings', async () => {
    const { scanBearer } = await import('@/lib/scanners/bearer')
    const check: ResolveCheckFn = vi.fn(() => true)

    // Bearer exits 1 when findings are found
    const spawn = fakeSpawn(bearerFixture, 1)

    const result = await scanBearer('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(1)

    const f = result.findings[0]
    expect(f.title).toBe('HTTP request with user-controlled URL')
    expect(f.severity).toBe('high')
    expect(f.locationPath).toBe('src/api/fetch.ts')
    expect(f.locationLineStart).toBe(42)
    expect(f.detector).toBe('bearer')
    expect(typeof f.description).toBe('string')
  })

  it('returns completed with empty findings when bearer exits 0 (no findings)', async () => {
    const { scanBearer } = await import('@/lib/scanners/bearer')
    const check: ResolveCheckFn = vi.fn(() => true)

    // Bearer exits 0 = no findings
    const spawn = fakeSpawn({ findings: [] }, 0)

    const result = await scanBearer('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })

  it('maps bearer severity levels to canonical severity', async () => {
    const { scanBearer } = await import('@/lib/scanners/bearer')
    const check: ResolveCheckFn = vi.fn(() => true)

    const fixture = {
      findings: [
        { id: 'a', title: 'Critical issue', description: 'desc', filename: 'a.ts', line_number: 1, severity: 'critical', fingerprint: '1' },
        { id: 'b', title: 'High issue', description: 'desc', filename: 'b.ts', line_number: 2, severity: 'high', fingerprint: '2' },
        { id: 'c', title: 'Medium issue', description: 'desc', filename: 'c.ts', line_number: 3, severity: 'medium', fingerprint: '3' },
        { id: 'd', title: 'Low issue', description: 'desc', filename: 'd.ts', line_number: 4, severity: 'low', fingerprint: '4' },
        { id: 'e', title: 'Warning issue', description: 'desc', filename: 'e.ts', line_number: 5, severity: 'warning', fingerprint: '5' },
      ],
    }

    const spawn = fakeSpawn(fixture, 1)
    const result = await scanBearer('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')

    expect(result.findings[0].severity).toBe('critical')
    expect(result.findings[1].severity).toBe('high')
    expect(result.findings[2].severity).toBe('medium')
    expect(result.findings[3].severity).toBe('low')
    expect(result.findings[4].severity).toBe('low') // warning → low
  })

  it('returns status error when bearer exits with unexpected code (not 0 or 1)', async () => {
    const { scanBearer } = await import('@/lib/scanners/bearer')
    const check: ResolveCheckFn = vi.fn(() => true)

    const spawn = fakeSpawnError('fatal error: scanner crashed', 2)

    const result = await scanBearer('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.reason).toContain('bearer exited with code 2')
  })
})
