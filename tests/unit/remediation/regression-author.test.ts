/**
 * tests/unit/remediation/regression-author.test.ts
 *
 * TDD: T-014 (RED) + T-015 (GREEN) — regression-author.ts
 * RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Tests the regression-author module:
 * - buildTurn3Prompt: builds the ACP Turn-3 prompt with description + patch_diff
 * - resolveTestPath: heuristic to find an appropriate test directory
 *
 * Design reference: design.md §6 (Q1 resolution), design.md §2.2 (Turn 3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Mocks declared BEFORE imports
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  }
})

import { buildTurn3Prompt, resolveTestPath } from '@/lib/remediation/fix-and-prove/regression-author'

const mockExistsSync = vi.mocked(fs.existsSync)
const mockReaddirSync = vi.mocked(fs.readdirSync) as ReturnType<typeof vi.fn>

// ─── buildTurn3Prompt ──────────────────────────────────────────────────────

describe('buildTurn3Prompt', () => {
  const description = 'SQL injection via unsanitized query parameter in login endpoint'
  const patchDiff = `diff --git a/src/auth/login.ts b/src/auth/login.ts
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
-const query = \`SELECT * FROM users WHERE email = '\${email}'\`
+const query = db.prepare('SELECT * FROM users WHERE email = ?').get(email)`

  it('includes the vulnerability description in the prompt', () => {
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts')
    expect(prompt).toContain(description)
  })

  it('includes the patch diff in the prompt', () => {
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts')
    expect(prompt).toContain(patchDiff)
  })

  it('instructs the agent to write a regression test file', () => {
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts')
    // Prompt should clearly state the goal: author a regression test
    expect(prompt.toLowerCase()).toMatch(/regression test|regression/)
    expect(prompt.toLowerCase()).toMatch(/write|create|author/)
  })

  it('includes the target file path in the prompt for context', () => {
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts')
    expect(prompt).toContain('src/auth/login.ts')
  })

  it('includes instructions to report the test file path back', () => {
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts')
    // Agent must report where it wrote the file so we can run it
    expect(prompt.toLowerCase()).toMatch(/path|file path|written/)
  })

  it('handles a vuln description with special characters without breaking', () => {
    const edgeDesc = `XSS in <script> injection via user's "name" field & query params`
    const prompt = buildTurn3Prompt(edgeDesc, patchDiff, '/repo/src/user.ts')
    expect(prompt).toContain(edgeDesc)
  })

  it('accepts a test path hint when provided', () => {
    const testPath = 'tests/__regression__/auth.regression.test.ts'
    const prompt = buildTurn3Prompt(description, patchDiff, '/repo/src/auth/login.ts', testPath)
    expect(prompt).toContain(testPath)
  })
})

// ─── resolveTestPath ───────────────────────────────────────────────────────

describe('resolveTestPath', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtp-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('picks "tests/" when that directory exists in projectDir', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('tests'))
    const result = resolveTestPath(tmpDir, 'src/auth/login.ts')
    expect(result).toContain('tests')
    expect(result).toContain('regression.test')
  })

  it('picks "__tests__/" when that directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('__tests__'))
    const result = resolveTestPath(tmpDir, 'src/auth/login.ts')
    expect(result).toContain('__tests__')
  })

  it('picks "test/" when that directory exists', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('test'))
    const result = resolveTestPath(tmpDir, 'src/auth/login.ts')
    expect(result).toContain('test')
  })

  it('falls back to __regression__/ sibling of the vuln file when no standard test dir exists', () => {
    mockExistsSync.mockReturnValue(false)
    const result = resolveTestPath(tmpDir, 'src/auth/login.ts')
    expect(result).toContain('__regression__')
    expect(result).toContain('login')
  })

  it('derives the test filename from the vulnerable file basename', () => {
    mockExistsSync.mockReturnValue(false)
    const result = resolveTestPath(tmpDir, 'src/db/query-builder.ts')
    expect(result).toContain('query-builder')
    expect(result).toMatch(/regression\.test\.ts$/)
  })

  it('returns a path that ends with .regression.test.ts', () => {
    mockExistsSync.mockReturnValue(false)
    const result = resolveTestPath(tmpDir, 'lib/utils.ts')
    expect(result).toMatch(/\.regression\.test\.ts$/)
  })

  it('prefers "tests/" over "__tests__/" when both exist', () => {
    // First call that returns true wins — tests/ is checked first
    let callCount = 0
    mockExistsSync.mockImplementation((p) => {
      const s = String(p)
      if (s.endsWith('tests') && !s.endsWith('__tests__')) {
        callCount++
        return true
      }
      return false
    })
    const result = resolveTestPath(tmpDir, 'src/foo.ts')
    expect(result).toMatch(/[/\\]tests[/\\]/)
  })
})
