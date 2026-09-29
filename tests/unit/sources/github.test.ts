import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { cloneGitHubRepo } from '@/lib/sources/github'

// Mock simple-git to observe how it's called
const mockClone = vi.fn()
const mockEnv = vi.fn()

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    clone: mockClone,
    env: mockEnv.mockReturnThis(),
  })),
  simpleGit: vi.fn(() => ({
    clone: mockClone,
    env: mockEnv.mockReturnThis(),
  })),
}))

describe('cloneGitHubRepo', () => {
  let tmpDir: string
  let destDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-gh-test-'))
    destDir = path.join(tmpDir, 'workspace', 'my-project')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects dest path outside workspace root', async () => {
    await expect(
      cloneGitHubRepo('https://github.com/owner/repo.git', '/etc/hack', '/tmp/workspace')
    ).rejects.toThrow(/path traversal/i)
  })

  it('rejects PAT injected as shell string in URL (security violation)', async () => {
    // PAT should never appear as part of the clone URL
    const urlWithPat = 'https://token:x-oauth-basic@github.com/owner/repo.git'
    await expect(
      cloneGitHubRepo(urlWithPat, destDir, '/tmp/workspace')
    ).rejects.toThrow(/PAT|token|credentials/i)
  })

  it('accepts a valid HTTPS GitHub URL', async () => {
    // Mock simple-git clone to succeed
    mockClone.mockReturnValue(Promise.resolve('ok'))

    // Create parent workspace dir
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    const result = await cloneGitHubRepo(
      'https://github.com/owner/repo.git',
      destDir,
      path.dirname(destDir)
    )

    // Clone should have been called
    expect(mockClone).toHaveBeenCalled()
    expect(result).toBe(destDir)
  })

  it('passes PAT via env, NOT via URL or command line', async () => {
    mockClone.mockReturnValue(Promise.resolve('ok'))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    await cloneGitHubRepo(
      'https://github.com/owner/repo.git',
      destDir,
      path.dirname(destDir),
      'ghp_testpat123'
    )

    // env() must have been called with GIT_ASKPASS-like mechanism
    expect(mockEnv).toHaveBeenCalled()

    // Clone URL passed to simple-git must NOT contain the PAT
    const cloneArgs = mockClone.mock.calls[0]
    const urlArg = cloneArgs[0]
    expect(urlArg).not.toContain('ghp_testpat123')
    expect(urlArg).not.toContain('x-oauth-basic')

    // Clone should NOT have --config or other shell args with the PAT
    const optionsArg = cloneArgs.length > 2 ? cloneArgs[2] : undefined
    if (optionsArg && Array.isArray(optionsArg)) {
      const optionsStr = optionsArg.join(' ')
      expect(optionsStr).not.toContain('ghp_testpat123')
    }
  })

  it('propagates git clone errors (e.g. repo not found)', async () => {
    const cloneError = new Error('remote: Repository not found.')
    mockClone.mockReturnValue(Promise.reject(cloneError))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    await expect(
      cloneGitHubRepo('https://github.com/owner/nonexistent.git', destDir, path.dirname(destDir))
    ).rejects.toThrow(/not found/i)
  })

  it('validates GitHub URL format — rejects non-GitHub URLs', async () => {
    await expect(
      cloneGitHubRepo('https://evil.com/owner/repo.git', destDir, '/tmp/workspace')
    ).rejects.toThrow(/github|url|invalid/i)
  })
})
