import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

vi.mock('node:child_process', () => {
  const fn = vi.fn()
  return {
    default: { spawn: fn },
    spawn: fn,
  }
})

const { existsSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn().mockReturnValue(false),
}))

vi.mock('node:fs', () => ({
  default: { existsSync: existsSyncMock },
  existsSync: existsSyncMock,
}))

import { spawn } from 'node:child_process'
import { spawnLoginShell, resolveUnixShell, getShellSpec } from '@/lib/providers/transport/spawn-shell'

function makeFakeProcess() {
  const ee = new EventEmitter() as ReturnType<typeof spawn> & EventEmitter
  const stdinStream = new PassThrough()
  ;(stdinStream as any).write = vi.fn()
  ;(stdinStream as any).end = vi.fn()
  ;(stdinStream as any).destroyed = false
  ;(ee as any).stdin = stdinStream
  ;(ee as any).stdout = new PassThrough()
  ;(ee as any).stderr = new PassThrough()
  ;(ee as any).pid = 12345
  ;(ee as any).killed = false
  ;(ee as any).kill = vi.fn((sig?: string) => {
    ;(ee as any).killed = true
    return true
  })
  return ee as any
}

// ---------------------------------------------------------------------------
// getShellSpec() — registry lookup
// ---------------------------------------------------------------------------

describe('getShellSpec', () => {
  it('returns correct spec for zsh', () => {
    expect(getShellSpec('zsh')).toEqual({ noRcFlag: '--no-rcs', loginFlag: true })
  })
  it('returns correct spec for bash', () => {
    expect(getShellSpec('bash')).toEqual({ noRcFlag: '--norc', loginFlag: true })
  })
  it('returns correct spec for ksh', () => {
    expect(getShellSpec('ksh')).toEqual({ noRcFlag: '--no-rcs', loginFlag: true })
  })
  it('returns correct spec for fish', () => {
    expect(getShellSpec('fish')).toEqual({ noRcFlag: '--no-config', loginFlag: false })
  })
  it('returns correct spec for sh', () => {
    expect(getShellSpec('sh')).toEqual({ noRcFlag: null, loginFlag: false })
  })
  it('returns correct spec for dash', () => {
    expect(getShellSpec('dash')).toEqual({ noRcFlag: null, loginFlag: false })
  })
  it('returns fallback spec for unknown shell', () => {
    expect(getShellSpec('csh')).toEqual({ noRcFlag: null, loginFlag: false })
  })
})

// ---------------------------------------------------------------------------
// resolveUnixShell() — shell detection with fallback chain
// ---------------------------------------------------------------------------

describe('resolveUnixShell', () => {
  const originalShell = process.env.SHELL

  beforeEach(() => {
    vi.mocked(existsSyncMock).mockReset()
    existsSyncMock.mockReturnValue(false)
  })

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  // ---- POSIX shells with login flag ----
  describe('POSIX shells with -l login flag', () => {
    it('returns zsh spec with loginFlag=true', () => {
      process.env.SHELL = '/bin/zsh'
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/zsh',
        spec: { noRcFlag: '--no-rcs', loginFlag: true },
      })
    })

    it('returns bash spec with loginFlag=true', () => {
      process.env.SHELL = '/usr/local/bin/bash'
      expect(resolveUnixShell()).toEqual({
        shell: '/usr/local/bin/bash',
        spec: { noRcFlag: '--norc', loginFlag: true },
      })
    })

    it('returns ksh spec with loginFlag=true', () => {
      process.env.SHELL = '/bin/ksh'
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/ksh',
        spec: { noRcFlag: '--no-rcs', loginFlag: true },
      })
    })
  })

  // ---- Shells without login flag ----
  describe('POSIX-compatible shells without -l', () => {
    it('returns fish spec with --no-config and loginFlag=false', () => {
      process.env.SHELL = '/opt/homebrew/bin/fish'
      expect(resolveUnixShell()).toEqual({
        shell: '/opt/homebrew/bin/fish',
        spec: { noRcFlag: '--no-config', loginFlag: false },
      })
    })

    it('returns sh spec with no rc flag and loginFlag=false', () => {
      process.env.SHELL = '/bin/sh'
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/sh',
        spec: { noRcFlag: null, loginFlag: false },
      })
    })

    it('returns dash spec with no rc flag and loginFlag=false', () => {
      process.env.SHELL = '/bin/dash'
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/dash',
        spec: { noRcFlag: null, loginFlag: false },
      })
    })
  })

  // ---- Non-POSIX shells → fallback ----
  describe('non-POSIX shells fallback', () => {
    it('falls back to /bin/bash when SHELL is csh', () => {
      process.env.SHELL = '/bin/csh'
      existsSyncMock.mockReturnValueOnce(true) // /bin/bash exists
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/bash',
        spec: { noRcFlag: '--norc', loginFlag: true },
      })
    })

    it('falls back to /usr/bin/bash when /bin/bash missing and SHELL is tcsh', () => {
      process.env.SHELL = '/bin/tcsh'
      existsSyncMock.mockReturnValueOnce(false) // /bin/bash missing
      existsSyncMock.mockReturnValueOnce(true)  // /usr/bin/bash exists
      expect(resolveUnixShell()).toEqual({
        shell: '/usr/bin/bash',
        spec: { noRcFlag: '--norc', loginFlag: true },
      })
    })

    it('falls back to /bin/sh when no bash found and SHELL is csh', () => {
      process.env.SHELL = '/usr/local/bin/tcsh'
      existsSyncMock.mockReturnValueOnce(false) // /bin/bash missing
      existsSyncMock.mockReturnValueOnce(false) // /usr/bin/bash missing
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/sh',
        spec: { noRcFlag: null, loginFlag: false },
      })
    })
  })

  // ---- SHELL not set at all ----
  describe('when SHELL is not set', () => {
    it('probes /bin/bash first', () => {
      delete process.env.SHELL
      existsSyncMock.mockReturnValueOnce(true) // /bin/bash exists
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/bash',
        spec: { noRcFlag: '--norc', loginFlag: true },
      })
    })

    it('falls back to /usr/bin/bash when /bin/bash missing', () => {
      delete process.env.SHELL
      existsSyncMock.mockReturnValueOnce(false) // /bin/bash missing
      existsSyncMock.mockReturnValueOnce(true)  // /usr/bin/bash exists
      expect(resolveUnixShell()).toEqual({
        shell: '/usr/bin/bash',
        spec: { noRcFlag: '--norc', loginFlag: true },
      })
    })

    it('falls back to /bin/sh when no bash found at all', () => {
      delete process.env.SHELL
      existsSyncMock.mockReturnValueOnce(false) // /bin/bash missing
      existsSyncMock.mockReturnValueOnce(false) // /usr/bin/bash missing
      expect(resolveUnixShell()).toEqual({
        shell: '/bin/sh',
        spec: { noRcFlag: null, loginFlag: false },
      })
    })
  })

  // ---- spawnLoginShell uses resolveUnixShell ----
  describe('spawnLoginShell integration', () => {
    it('spawns with --norc and -l for bash', () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReset()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)
      process.env.SHELL = '/usr/local/bin/bash'

      spawnLoginShell('my-agent', ['--acp'], { cwd: '/tmp' })

      const callArgs = vi.mocked(spawn).mock.calls[0]
      expect(callArgs[0]).toBe('/usr/local/bin/bash')
      expect(callArgs[1]).toEqual(expect.arrayContaining(['--norc', '-l', '-c']))
    })

    it('spawns with --no-config and no -l for fish', () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReset()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)
      process.env.SHELL = '/opt/homebrew/bin/fish'

      spawnLoginShell('my-agent', ['--acp'], { cwd: '/tmp' })

      const callArgs = vi.mocked(spawn).mock.calls[0]
      expect(callArgs[0]).toBe('/opt/homebrew/bin/fish')
      expect(callArgs[1]).toEqual(expect.arrayContaining(['--no-config', '-c']))
      expect(callArgs[1]).not.toContain('-l')
    })

    it('spawns with no rc flag for sh (sh has no --norc equivalent)', () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReset()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)
      process.env.SHELL = '/bin/sh'

      spawnLoginShell('my-agent', [], { cwd: '/tmp' })

      const callArgs = vi.mocked(spawn).mock.calls[0]
      expect(callArgs[0]).toBe('/bin/sh')
      // sh: noRcFlag is null → args are just ['-c', cmd]
      expect(callArgs[1]).toContain('-c')
      expect(callArgs[1]).not.toContain('--no-rcs')
      expect(callArgs[1]).not.toContain('--norc')
      expect(callArgs[1]).not.toContain('-l')
    })
  })
})

describe('spawnLoginShell', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(spawn).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns via resolveUnixShell with --norc and -l for bash', () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)
    const originalShell = process.env.SHELL
    process.env.SHELL = '/bin/bash'

    const result = spawnLoginShell('my-agent', ['--acp'], { cwd: '/tmp' })

    expect(result.process).toBe(fakeProc)
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      '/bin/bash',
      expect.arrayContaining(['--norc', '-l', '-c']),
      expect.objectContaining({ cwd: '/tmp' }),
    )
    process.env.SHELL = originalShell
  })

  it('falls back to /bin/sh (no rc flag) when SHELL is not set and no bash found', () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)
    const originalShell = process.env.SHELL
    delete process.env.SHELL

    // existsSync returns false → probes /bin/bash, /usr/bin/bash, falls back to /bin/sh
    spawnLoginShell('my-agent', ['--acp'], { cwd: '/tmp' })

    const callArgs = vi.mocked(spawn).mock.calls[0]
    expect(callArgs[0]).toBe('/bin/sh')
    // sh has no rc flag — args must be ['-c', cmd] only
    expect(callArgs[1]).not.toContain('--no-rcs')
    expect(callArgs[1]).not.toContain('--norc')
    expect(callArgs[1]).toContain('-c')
    process.env.SHELL = originalShell
  })

  it('shell-escapes the command and args with single quotes', () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)
    const originalShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'

    spawnLoginShell('my-agent', ['--flag', "arg with 'single'"], { cwd: '/tmp' })

    const callArgs = vi.mocked(spawn).mock.calls[0]
    const shellCmd = callArgs[1][3] as string
    // Should quote each argument in single quotes
    expect(shellCmd).toContain("'my-agent'")
    expect(shellCmd).toContain("'--flag'")
    // Single quotes in args should be escaped
    expect(shellCmd).toContain("arg with ")
    process.env.SHELL = originalShell
  })

  it('returns SpawnResult with process, stdout, stderr, exited', () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)

    const result = spawnLoginShell('my-agent', [], { cwd: '/tmp' })

    expect(result).toHaveProperty('process')
    expect(result).toHaveProperty('stdout')
    expect(result).toHaveProperty('stderr')
    expect(result).toHaveProperty('exited')
  })

  it('SIGTERM teardown: sends SIGTERM on kill, then SIGKILL after 5s', async () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)

    const result = spawnLoginShell('my-agent', [], { cwd: '/tmp' })

    result.kill()

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')

    vi.advanceTimersByTime(5000)
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does not send SIGKILL if process exits before 5s timeout', async () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)

    const result = spawnLoginShell('my-agent', [], { cwd: '/tmp' })

    result.kill()
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')

    fakeProc.emit('close', 0, null)

    vi.advanceTimersByTime(5000)
    expect(fakeProc.kill).not.toHaveBeenCalledWith('SIGKILL')
  })

  it('exited promise resolves with code and signal on close', async () => {
    const fakeProc = makeFakeProcess()
    vi.mocked(spawn).mockReturnValueOnce(fakeProc)

    const result = spawnLoginShell('my-agent', [], { cwd: '/tmp' })

    const exitPromise = result.exited
    fakeProc.emit('close', 0, null)

    const exit = await exitPromise
    expect(exit.code).toBe(0)
    expect(exit.signal).toBeNull()
  })
})
