import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { cloneGitLabRepo } from '@/lib/sources/gitlab'

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

describe('cloneGitLabRepo', () => {
  let tmpDir: string
  let destDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-gl-test-'))
    destDir = path.join(tmpDir, 'workspace', 'my-project')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects dest path outside workspace root', async () => {
    await expect(
      cloneGitLabRepo('https://gitlab.com/group/project.git', '/etc/hack', '/tmp/workspace')
    ).rejects.toThrow(/path traversal/i)
  })

  it('rejects PAT injected in URL (security violation)', async () => {
    const urlWithPat = 'https://gitlab-ci-token:glpat-123@gitlab.com/group/project.git'
    await expect(
      cloneGitLabRepo(urlWithPat, destDir, '/tmp/workspace')
    ).rejects.toThrow(/PAT|token|credentials/i)
  })

  it('accepts a valid HTTPS GitLab URL', async () => {
    mockClone.mockReturnValue(Promise.resolve('ok'))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    const result = await cloneGitLabRepo(
      'https://gitlab.com/group/project.git',
      destDir,
      path.dirname(destDir)
    )

    expect(mockClone).toHaveBeenCalled()
    expect(result).toBe(destDir)
  })

  it('passes PAT via env, NOT via URL or command line', async () => {
    mockClone.mockReturnValue(Promise.resolve('ok'))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    await cloneGitLabRepo(
      'https://gitlab.com/group/project.git',
      destDir,
      path.dirname(destDir),
      'glpat-abc123'
    )

    expect(mockEnv).toHaveBeenCalled()

    const urlArg = mockClone.mock.calls[0][0]
    expect(urlArg).not.toContain('glpat-abc123')

    const optionsArg = mockClone.mock.calls.length > 2 ? mockClone.mock.calls[2] : undefined
    if (optionsArg && Array.isArray(optionsArg)) {
      const optionsStr = optionsArg.join(' ')
      expect(optionsStr).not.toContain('glpat-abc123')
    }
  })

  it('propagates git clone errors', async () => {
    const cloneError = new Error('fatal: Authentication failed')
    mockClone.mockReturnValue(Promise.reject(cloneError))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    await expect(
      cloneGitLabRepo('https://gitlab.com/group/private.git', destDir, path.dirname(destDir))
    ).rejects.toThrow(/Authentication/i)
  })

  it('validates GitLab URL format — rejects non-GitLab URLs', async () => {
    await expect(
      cloneGitLabRepo('https://evil.com/group/project.git', destDir, '/tmp/workspace')
    ).rejects.toThrow(/gitlab|url|invalid/i)
  })

  it('accepts self-managed GitLab URLs', async () => {
    mockClone.mockReturnValue(Promise.resolve('ok'))
    fs.mkdirSync(path.dirname(destDir), { recursive: true })

    const result = await cloneGitLabRepo(
      'https://gitlab.internal.company.com/team/repo.git',
      destDir,
      path.dirname(destDir)
    )

    expect(mockClone).toHaveBeenCalled()
    expect(result).toBe(destDir)
  })
})
