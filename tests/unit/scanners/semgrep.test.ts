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

describe('scanSemgrep', () => {
  it('returns status skipped when semgrep binary is not found', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')
    const check: ResolveCheckFn = vi.fn(() => false)

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check })

    expect(check).toHaveBeenCalledWith('semgrep')
    expect(result.status).toBe('skipped')
    if (result.status === 'skipped') {
      expect(result.reason).toBe('binary not found')
    }
  })

  it('normalises semgrep JSON output to canonical findings', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')

    const semgrepFixture = {
      version: '1.0.0',
      results: [
        {
          check_id: 'python.lang.security.audit.sqlalchemy-sql-injection',
          path: 'src/api/users.py',
          start: { line: 25, col: 9 },
          end: { line: 25, col: 42 },
          extra: {
            message: 'Detected SQLAlchemy expression built from user input.',
            severity: 'WARNING',
            metadata: { cwe: ['CWE-89'] },
          },
        },
        {
          check_id: 'js.lang.security.audit.xss.no-react-danger',
          path: 'src/components/Profile.tsx',
          start: { line: 18, col: 5 },
          end: { line: 20, col: 7 },
          extra: {
            message: 'Found usage of dangerouslySetInnerHTML.',
            severity: 'ERROR',
            metadata: {},
          },
        },
      ],
    }

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(semgrepFixture)

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(2)

    const [f1, f2] = result.findings

    // Semgrep WARNING → medium
    expect(f1.title).toBe('python.lang.security.audit.sqlalchemy-sql-injection')
    expect(f1.description).toBe('Detected SQLAlchemy expression built from user input.')
    expect(f1.severity).toBe('medium')
    expect(f1.locationPath).toBe('src/api/users.py')
    expect(f1.locationLineStart).toBe(25)
    expect(f1.locationLineEnd).toBe(25)
    expect(f1.detector).toBe('semgrep')

    // Semgrep ERROR → high
    expect(f2.title).toBe('js.lang.security.audit.xss.no-react-danger')
    expect(f2.description).toBe('Found usage of dangerouslySetInnerHTML.')
    expect(f2.severity).toBe('high')
    expect(f2.locationPath).toBe('src/components/Profile.tsx')
    expect(f2.locationLineStart).toBe(18)
    expect(f2.locationLineEnd).toBe(20)
    expect(f2.detector).toBe('semgrep')
  })

  it('handles semgrep INFO severity as info', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')

    const semgrepFixture = {
      results: [
        {
          check_id: 'best-practice.rule',
          path: 'src/utils.ts',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 1 },
          extra: {
            message: 'Consider using const.',
            severity: 'INFO',
            metadata: {},
          },
        },
      ],
    }

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn(semgrepFixture)

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check, spawn })

    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings[0].severity).toBe('info')
  })

  it('handles empty results array', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn({ results: [] })

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })

  it('returns status error when semgrep exits with non-zero code', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawnError('semgrep: error: target not found')

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected error')
    expect(result.reason).toContain('semgrep exited with code 1')
  })

  it('handles response missing results field gracefully', async () => {
    const { scanSemgrep } = await import('@/lib/scanners/semgrep')

    const check: ResolveCheckFn = vi.fn(() => true)
    const spawn = fakeSpawn({ errors: ['something went wrong'] })

    const result = await scanSemgrep('/tmp/repo', { resolveCheck: check, spawn })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error('expected completed')
    expect(result.findings).toHaveLength(0)
  })
})
