import { describe, it, expect, vi } from 'vitest'
import type { ScannerSpawnResult, ResolveCheckFn } from '@/lib/scanners/types'

// Helper: convert a string to an AsyncIterable (simulates a single-chunk stdout)
async function* stringIterable(s: string): AsyncIterable<string> {
  yield s
}

/** Build a fake spawn result from fixture JSON */
function fakeSpawn(stdoutJson: unknown): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(JSON.stringify(stdoutJson)),
    stderr: stringIterable(''),
    exited: Promise.resolve({ code: 0, signal: null }),
  })
}

/** Fake spawn that yields an error exit */
function fakeSpawnError(stderrMsg: string): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(''),
    stderr: stringIterable(stderrMsg),
    exited: Promise.resolve({ code: 1, signal: null }),
  })
}

describe('scanGitleaks', () => {
  // Dynamically import after module exists — for now this test WILL fail
  // because @/lib/scanners/gitleaks doesn't exist (RED phase).

  it('returns status skipped when gitleaks binary is not found', async () => {
    const { scanGitleaks } = await import('@/lib/scanners/gitleaks')
    const check: ResolveCheckFn = vi.fn(() => false)

    const result = await scanGitleaks('/tmp/repo', { resolveCheck: check })

    expect(check).toHaveBeenCalledWith('gitleaks')
    expect(result.status).toBe('skipped')
    expect('reason' in result && result.reason).toBe('binary not found')
  })

  it('normalises gitleaks JSON output to canonical findings', async () => {
    const { scanGitleaks } = await import('@/lib/scanners/gitleaks')

    const gitleaksFixture = [
      {
        Description: 'AWS Access Key',
        Secret: 'AKIAIOSFODNN7EXAMPLE',
        File: 'config/secrets.env',
        StartLine: 4,
        EndLine: 4,
        RuleID: 'aws-access-key',
        Match: 'AKIAIOSFODNN7EXAMPLE...',
      },
      {
        Description: 'Generic API Key',
        Secret: 'sk_live_1234567890abcdef',
        File: 'src/api/client.ts',
        StartLine: 12,
        EndLine: 12,
        RuleID: 'generic-api-key',
        Match: 'sk_live_1234567890abcdef',
      },
    ]

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(gitleaksFixture)

    const result = await scanGitleaks('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(2)

    const [f1, f2] = result.findings
    expect(f1.title).toBe('aws-access-key')
    expect(f1.description).toBe('AWS Access Key')
    expect(f1.severity).toBe('high')
    expect(f1.locationPath).toBe('config/secrets.env')
    expect(f1.locationLineStart).toBe(4)
    expect(f1.locationLineEnd).toBe(4)
    expect(f1.detector).toBe('gitleaks')

    expect(f2.title).toBe('generic-api-key')
    expect(f2.description).toBe('Generic API Key')
    expect(f2.severity).toBe('high')
    expect(f2.locationPath).toBe('src/api/client.ts')
    expect(f2.locationLineStart).toBe(12)
    expect(f2.locationLineEnd).toBe(12)
    expect(f2.detector).toBe('gitleaks')
  })

  it('handles empty findings array from gitleaks', async () => {
    const { scanGitleaks } = await import('@/lib/scanners/gitleaks')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn([])

    const result = await scanGitleaks('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })

  it('handles gitleaks findings with missing optional EndLine', async () => {
    const { scanGitleaks } = await import('@/lib/scanners/gitleaks')

    const gitleaksFixture = [
      {
        Description: 'GitHub Token',
        Secret: 'ghp_1234567890abcdef',
        File: '.github/workflows/ci.yml',
        StartLine: 5,
        RuleID: 'github-token',
        Match: 'ghp_1234567890abcdef...',
      },
    ]

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(gitleaksFixture)

    const result = await scanGitleaks('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings[0].locationLineStart).toBe(5)
    expect(result.findings[0].locationLineEnd).toBeUndefined()
  })

  it('returns status error when gitleaks exits with non-zero code', async () => {
    const { scanGitleaks } = await import('@/lib/scanners/gitleaks')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawnError('permission denied')

    const result = await scanGitleaks('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.reason).toContain('gitleaks exited with code 1')
  })
})
