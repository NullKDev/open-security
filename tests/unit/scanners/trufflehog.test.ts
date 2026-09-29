import { describe, it, expect, vi } from 'vitest'
import type { ScannerSpawnResult, ResolveCheckFn } from '@/lib/scanners/types'

async function* stringIterable(s: string): AsyncIterable<string> {
  yield s
}

function fakeSpawn(stdoutLines: string[]): () => ScannerSpawnResult {
  return () => ({
    stdout: stringIterable(stdoutLines.join('\n') + '\n'),
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

describe('scanTrufflehog', () => {
  it('returns status skipped when trufflehog binary is not found', async () => {
    const { scanTrufflehog } = await import('@/lib/scanners/trufflehog')
    const check: ResolveCheckFn = vi.fn(() => false)

    const result = await scanTrufflehog('/tmp/repo', { resolveCheck: check })

    expect(check).toHaveBeenCalledWith('trufflehog')
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('binary not found')
    }
  })

  it('normalises trufflehog NDJSON output to canonical findings', async () => {
    const { scanTrufflehog } = await import('@/lib/scanners/trufflehog')

    const lines = [
      JSON.stringify({
        DetectorName: 'GitHub',
        DecoderName: 'PLAIN',
        Verified: false,
        Raw: 'ghp_1234567890abcdef',
        SourceMetadata: {
          Data: {
            Filesystem: { file: 'config/secrets.env', line: 4 },
          },
        },
      }),
      JSON.stringify({
        DetectorName: 'AWS',
        DecoderName: 'PLAIN',
        Verified: true,
        Raw: 'AKIAIOSFODNN7EXAMPLE',
        SourceMetadata: {
          Data: {
            Filesystem: { file: 'src/aws.ts', line: 22 },
          },
        },
      }),
    ]

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(lines)

    const result = await scanTrufflehog('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(2)

    const [f1, f2] = result.findings

    // Verified false → severity medium
    expect(f1.title).toBe('GitHub')
    expect(f1.description).toBe('ghp_1234567890abcdef')
    expect(f1.severity).toBe('medium')
    expect(f1.locationPath).toBe('config/secrets.env')
    expect(f1.locationLineStart).toBe(4)
    expect(f1.detector).toBe('trufflehog')

    // Verified true → severity high
    expect(f2.title).toBe('AWS')
    expect(f2.description).toBe('AKIAIOSFODNN7EXAMPLE')
    expect(f2.severity).toBe('high')
    expect(f2.locationPath).toBe('src/aws.ts')
    expect(f2.locationLineStart).toBe(22)
    expect(f2.detector).toBe('trufflehog')
  })

  it('handles empty stdout from trufflehog (no findings)', async () => {
    const { scanTrufflehog } = await import('@/lib/scanners/trufflehog')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn([])

    const result = await scanTrufflehog('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })

  it('handles trufflehog line with missing optional Filesystem data', async () => {
    const { scanTrufflehog } = await import('@/lib/scanners/trufflehog')

    const lines = [
      JSON.stringify({
        DetectorName: 'PrivateKey',
        DecoderName: 'PLAIN',
        Verified: false,
        Raw: '-----BEGIN RSA PRIVATE KEY-----',
        SourceMetadata: { Data: {} },
      }),
    ]

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(lines)

    const result = await scanTrufflehog('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings[0].locationPath).toBe('')
    expect(result.findings[0].locationLineStart).toBe(0)
  })

  it('returns status error when trufflehog exits with non-zero code', async () => {
    const { scanTrufflehog } = await import('@/lib/scanners/trufflehog')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawnError('configuration error')

    const result = await scanTrufflehog('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.reason).toContain('trufflehog exited with code 1')
  })
})
