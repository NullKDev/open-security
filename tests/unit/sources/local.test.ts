import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { copyLocalSource } from '@/lib/sources/local'

describe('copyLocalSource', () => {
  let tmpDir: string
  let workspaceRoot: string
  let sourceDir: string
  let destDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obt-local-test-'))
    workspaceRoot = path.join(tmpDir, 'workspace')
    sourceDir = path.join(tmpDir, 'source')
    destDir = path.join(workspaceRoot, 'imported')

    // Create a source directory with some files
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.mkdirSync(path.join(sourceDir, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(sourceDir, 'readme.txt'), 'hello')
    fs.writeFileSync(path.join(sourceDir, 'sub', 'data.txt'), 'world')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects copying from /etc (system path outside workspace)', async () => {
    await expect(
      copyLocalSource('/etc', destDir, workspaceRoot)
    ).rejects.toThrow(/path traversal|outside/i)
  })

  it('rejects dest path outside workspace root', async () => {
    await expect(
      copyLocalSource(sourceDir, '/etc/hack', workspaceRoot)
    ).rejects.toThrow(/path traversal/i)
  })

  it('rejects source that is outside workspace root', async () => {
    // Source is in tmpDir, not under workspaceRoot — should be rejected
    await expect(
      copyLocalSource(sourceDir, destDir, workspaceRoot)
    ).rejects.toThrow(/path traversal|outside/i)
  })

  it('accepts valid source within accepted root', async () => {
    // Use a separate accepted root that encompasses the source
    const result = await copyLocalSource(sourceDir, destDir, tmpDir)
    expect(result).toBe(destDir)
    expect(fs.existsSync(path.join(destDir, 'readme.txt'))).toBe(true)
    expect(fs.existsSync(path.join(destDir, 'sub', 'data.txt'))).toBe(true)
  })

  it('copied files match source content', async () => {
    await copyLocalSource(sourceDir, destDir, tmpDir)

    expect(fs.readFileSync(path.join(destDir, 'readme.txt'), 'utf-8')).toBe('hello')
    expect(fs.readFileSync(path.join(destDir, 'sub', 'data.txt'), 'utf-8')).toBe('world')
  })

  it('creates destination directory if it does not exist', async () => {
    const newDest = path.join(workspaceRoot, 'new-dir')
    // workspaceRoot exists but newDest doesn't
    fs.mkdirSync(workspaceRoot, { recursive: true })

    await copyLocalSource(sourceDir, newDest, tmpDir)
    expect(fs.existsSync(newDest)).toBe(true)
    expect(fs.existsSync(path.join(newDest, 'readme.txt'))).toBe(true)
  })

  it('rejects source that does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'non-existent')
    await expect(
      copyLocalSource(nonExistent, destDir, tmpDir)
    ).rejects.toThrow(/ENOENT|no such file|not a directory/i)
  })
})
