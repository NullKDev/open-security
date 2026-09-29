/**
 * tests/unit/diff/import-expander.test.ts
 *
 * TDD: T-D01 — 1-hop import expansion
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Vitest 4 requires importOriginal to spread the actual module when using namespace imports.
// The implementation uses `import * as cp from 'node:child_process'` which requires the
// full module to be spread — execFile is then replaced with a vi.fn().
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile: vi.fn(),
  }
})

import * as child_process from 'node:child_process'
const { expandImports } = await import('@/lib/diff/import-expander')

describe('expandImports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('exports expandImports as a function', () => {
    expect(typeof expandImports).toBe('function')
  })

  it('returns empty array when changedFiles is empty', async () => {
    const result = await expandImports([], '/repo')
    expect(result).toEqual([])
  })

  it('returns changedFiles themselves when no importers found', async () => {
    const mockExecFile = vi.mocked(child_process.execFile)
    // rg finds nothing → stdout is empty
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => {
      if (cb) cb(null, '', '')
      return {} as ReturnType<typeof child_process.execFile>
    })

    const result = await expandImports(['src/auth/login.ts'], '/repo')
    // Should contain at least the original changed file
    expect(result).toContain('src/auth/login.ts')
  })

  it('returns 1-hop importers found by rg', async () => {
    const mockExecFile = vi.mocked(child_process.execFile)
    // rg returns two files that import from src/auth/login.ts
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => {
      if (cb) cb(null, 'src/app/page.tsx\nsrc/components/Auth.tsx\n', '')
      return {} as ReturnType<typeof child_process.execFile>
    })

    const result = await expandImports(['src/auth/login.ts'], '/repo')
    expect(result).toContain('src/auth/login.ts')
    expect(result).toContain('src/app/page.tsx')
    expect(result).toContain('src/components/Auth.tsx')
  })

  it('deduplicates paths across multiple changed files', async () => {
    const mockExecFile = vi.mocked(child_process.execFile)
    // Both changed files share a common importer
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => {
      if (cb) cb(null, 'src/shared/utils.ts\n', '')
      return {} as ReturnType<typeof child_process.execFile>
    })

    const result = await expandImports(['src/auth/login.ts', 'src/auth/signup.ts'], '/repo')
    const count = result.filter((p) => p === 'src/shared/utils.ts').length
    expect(count).toBe(1)
  })

  it('falls back gracefully when rg is not available', async () => {
    const mockExecFile = vi.mocked(child_process.execFile)
    // rg not found — error code ENOENT, then grep succeeds
    let callCount = 0
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => {
      callCount++
      if (callCount === 1) {
        // First call: rg fails
        const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        if (cb) cb(err, '', '')
      } else {
        // Second call: grep fallback succeeds
        if (cb) cb(null, 'src/index.ts\n', '')
      }
      return {} as ReturnType<typeof child_process.execFile>
    })

    const result = await expandImports(['src/auth/login.ts'], '/repo')
    expect(result).toContain('src/auth/login.ts')
    // grep fallback result
    expect(result).toContain('src/index.ts')
  })

  it('filters out non-source files from results', async () => {
    const mockExecFile = vi.mocked(child_process.execFile)
    mockExecFile.mockImplementation((_bin, _args, _opts, cb) => {
      // Mix of valid source files and non-source matches
      if (cb) cb(null, 'src/valid.ts\nnode_modules/lib/index.js\nsrc/other.tsx\n', '')
      return {} as ReturnType<typeof child_process.execFile>
    })

    const result = await expandImports(['src/auth/login.ts'], '/repo')
    expect(result).toContain('src/valid.ts')
    expect(result).toContain('src/other.tsx')
    expect(result).not.toContain('node_modules/lib/index.js')
  })
})
