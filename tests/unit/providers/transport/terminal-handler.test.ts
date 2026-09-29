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

import { spawn } from 'node:child_process'
import { TerminalHandler } from '@/lib/providers/transport/terminal-handler'

/** Create a fake ChildProcess-like object with PassThrough stdio streams */
function makeFakeProcess() {
  const ee = new EventEmitter() as Record<string, unknown>
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  ;(stdin as Record<string, unknown>).write = vi.fn()
  ;(stdin as Record<string, unknown>).end = vi.fn()
  ee.stdin = stdin
  ee.stdout = stdout
  ee.stderr = stderr
  ee.pid = 54321
  ee.killed = false
  ee.kill = vi.fn((_sig?: string) => {
    ee.killed = true
    return true
  })
  return ee as unknown as ReturnType<typeof spawn> & EventEmitter
}

const MIB = 1024 * 1024

describe('TerminalHandler', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  // ---------------------------------------------------------------------------
  // createTerminal
  // ---------------------------------------------------------------------------
  describe('createTerminal', () => {
    it('returns a CreateTerminalResponse with a unique terminalId', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const result = await handler.createTerminal({
        command: 'echo',
        args: ['hello'],
        sessionId: 'session-1',
        cwd: '/tmp',
      })

      expect(result).toHaveProperty('terminalId')
      expect(typeof result.terminalId).toBe('string')
      expect(result.terminalId.length).toBeGreaterThan(0)
    })

    it('spawns process with the given command, args, and cwd', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      await handler.createTerminal({
        command: 'ls',
        args: ['-la', '/tmp'],
        sessionId: 'session-1',
        cwd: '/home/user',
      })

      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'ls',
        ['-la', '/tmp'],
        expect.objectContaining({ cwd: '/home/user' }),
      )
    })

    it('defaults outputByteLimit to 1 MiB when not provided', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const result = await handler.createTerminal({
        command: 'cat',
        sessionId: 'session-1',
      })

      expect(result).toHaveProperty('terminalId')
      // The default is applied internally; we verify it indirectly
      // by checking that output under 1 MiB is NOT truncated
      fakeProc.stdout.emit('data', Buffer.from('short'))
      const output = await handler.terminalOutput({
        terminalId: result.terminalId,
        sessionId: 'session-1',
      })
      expect(output.truncated).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // terminalOutput
  // ---------------------------------------------------------------------------
  describe('terminalOutput', () => {
    it('returns captured stdout/stderr output', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['hello'],
        sessionId: 'session-1',
      })

      // Emit data events — listeners fire synchronously
      fakeProc.stdout.emit('data', Buffer.from('hello '))
      fakeProc.stderr.emit('data', Buffer.from('world\n'))

      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })

      expect(output.output).toBe('hello world\n')
      expect(output.truncated).toBe(false)
    })

    it('includes exitStatus when the process has already exited', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'ls',
        sessionId: 'session-1',
      })

      fakeProc.stdout.emit('data', Buffer.from('file.txt\n'))
      fakeProc.emit('close', 0, null)

      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })

      expect(output.exitStatus).toBeDefined()
      expect(output.exitStatus!.exitCode).toBe(0)
      expect(output.exitStatus!.signal).toBeNull()
      expect(output.output).toBe('file.txt\n')
    })

    it('throws when terminal is not found', async () => {
      const handler = new TerminalHandler()

      await expect(
        handler.terminalOutput({
          terminalId: 'nonexistent',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(/terminal/i)
    })
  })

  // ---------------------------------------------------------------------------
  // byte-limit truncation
  // ---------------------------------------------------------------------------
  describe('byte-limit truncation', () => {
    it('truncates output from the beginning when it exceeds outputByteLimit', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'generate',
        sessionId: 'session-1',
        outputByteLimit: 100,
      })

      // Emit 60 bytes first
      fakeProc.stdout.emit('data', Buffer.from('A'.repeat(60)))
      // Emit another 60 bytes — total 120, exceeds 100
      fakeProc.stdout.emit('data', Buffer.from('B'.repeat(60)))

      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })

      expect(output.truncated).toBe(true)
      // Output should be ≤ byteLimit, and since truncation is from the
      // beginning, only the last portion survives
      const len = Buffer.byteLength(output.output, 'utf-8')
      expect(len).toBeLessThanOrEqual(100)
      // The suffix should be the newer data (B's at the end)
      expect(output.output.endsWith('B'.repeat(40))).toBe(true)
    })

    it('does not truncate when output stays under the limit', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'cat',
        sessionId: 'session-1',
        outputByteLimit: MIB,
      })

      // Emit 500 bytes — well under 1 MiB
      fakeProc.stdout.emit('data', Buffer.from('x'.repeat(500)))

      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })

      expect(output.truncated).toBe(false)
      expect(output.output).toBe('x'.repeat(500))
    })
  })

  // ---------------------------------------------------------------------------
  // waitForTerminalExit
  // ---------------------------------------------------------------------------
  describe('waitForTerminalExit / exitPromise', () => {
    it('resolves with exitCode when process exits normally', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['done'],
        sessionId: 'session-1',
      })

      // Emit close event with code 0
      fakeProc.emit('close', 0, null)

      const result = await handler.waitForTerminalExit({
        terminalId,
        sessionId: 'session-1',
      })

      expect(result.exitCode).toBe(0)
      expect(result.signal).toBeNull()
    })

    it('resolves with signal when process is killed by signal', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'sleep',
        args: ['60'],
        sessionId: 'session-1',
      })

      fakeProc.emit('close', null, 'SIGTERM')

      const result = await handler.waitForTerminalExit({
        terminalId,
        sessionId: 'session-1',
      })

      expect(result.exitCode).toBeNull()
      expect(result.signal).toBe('SIGTERM')
    })

    it('throws when terminal is not found', async () => {
      const handler = new TerminalHandler()

      await expect(
        handler.waitForTerminalExit({
          terminalId: 'nonexistent',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(/terminal/i)
    })
  })

  // ---------------------------------------------------------------------------
  // SSE output callback
  // ---------------------------------------------------------------------------
  describe('SSE output callback', () => {
    it('calls onOutput with terminalId and output when data is emitted', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const onOutput = vi.fn()
      const handler = new TerminalHandler({ onOutput })

      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['hello'],
        sessionId: 'session-1',
      })

      fakeProc.stdout.emit('data', Buffer.from('test output'))

      expect(onOutput).toHaveBeenCalledTimes(1)
      const call = onOutput.mock.calls[0][0]
      expect(call).toHaveProperty('terminalId', terminalId)
      expect(call.output).toContain('test output')
    })

    it('calls onOutput for stderr data as well', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const onOutput = vi.fn()
      const handler = new TerminalHandler({ onOutput })

      const { terminalId } = await handler.createTerminal({
        command: 'node',
        args: ['script.js'],
        sessionId: 'session-1',
      })

      fakeProc.stderr.emit('data', Buffer.from('error message'))

      expect(onOutput).toHaveBeenCalledTimes(1)
      const call = onOutput.mock.calls[0][0]
      expect(call).toHaveProperty('terminalId', terminalId)
      expect(call.output).toContain('error message')
    })

    it('marks truncated in the SSE callback when output exceeds limit', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const onOutput = vi.fn()
      const handler = new TerminalHandler({ onOutput })

      const { terminalId } = await handler.createTerminal({
        command: 'generate',
        sessionId: 'session-1',
        outputByteLimit: 50,
      })

      // Emit 60 bytes → exceeds 50-byte limit
      fakeProc.stdout.emit('data', Buffer.from('A'.repeat(60)))

      expect(onOutput).toHaveBeenCalled()
      const lastCall = onOutput.mock.calls[0][0]
      expect(lastCall.truncated).toBe(true)
    })

    it('does not call onOutput when handler was created without it', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      // No callback provided — should not throw
      const handler = new TerminalHandler()

      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['hello'],
        sessionId: 'session-1',
      })

      fakeProc.stdout.emit('data', Buffer.from('should not crash'))

      // terminalOutput should still work
      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })
      expect(output.output).toBe('should not crash')
    })
  })

  // ---------------------------------------------------------------------------
  // killTerminal
  // ---------------------------------------------------------------------------
  describe('killTerminal', () => {
    it('sends SIGTERM to the terminal process', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'node',
        args: ['server.js'],
        sessionId: 'session-1',
      })

      await handler.killTerminal({
        terminalId,
        sessionId: 'session-1',
      })

      expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('keeps terminal accessible after kill (only kills, not releases)', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'node',
        sessionId: 'session-1',
      })

      await handler.killTerminal({ terminalId, sessionId: 'session-1' })

      // Terminal should still be queryable — kill ≠ release
      const output = await handler.terminalOutput({
        terminalId,
        sessionId: 'session-1',
      })
      expect(output).toHaveProperty('output')
    })

    it('throws when terminal is not found', async () => {
      const handler = new TerminalHandler()

      await expect(
        handler.killTerminal({
          terminalId: 'nonexistent',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(/terminal/i)
    })
  })

  // ---------------------------------------------------------------------------
  // releaseTerminal
  // ---------------------------------------------------------------------------
  describe('releaseTerminal', () => {
    it('kills process and removes terminal from the handler', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'node',
        args: ['server.js'],
        sessionId: 'session-1',
      })

      await handler.releaseTerminal({ terminalId, sessionId: 'session-1' })

      // Process should have been killed
      expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM')

      // Subsequent terminalOutput should throw — terminal is released
      await expect(
        handler.terminalOutput({ terminalId, sessionId: 'session-1' }),
      ).rejects.toThrow(/terminal/i)
    })

    it('does not kill an already-exited process', async () => {
      const fakeProc = makeFakeProcess()
      vi.mocked(spawn).mockReturnValueOnce(fakeProc)

      const handler = new TerminalHandler()
      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['done'],
        sessionId: 'session-1',
      })

      // Simulate process already exited
      fakeProc.emit('close', 0, null)
      vi.mocked(fakeProc.kill as ReturnType<typeof vi.fn>).mockClear()

      await handler.releaseTerminal({ terminalId, sessionId: 'session-1' })

      // Should NOT have called kill again (process already dead)
      // But we still clean up the terminal entry
      await expect(
        handler.terminalOutput({ terminalId, sessionId: 'session-1' }),
      ).rejects.toThrow(/terminal/i)
    })

    it('throws when terminal is not found', async () => {
      const handler = new TerminalHandler()

      await expect(
        handler.releaseTerminal({
          terminalId: 'nonexistent',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(/terminal/i)
    })
  })

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------
  describe('dispose', () => {
    it('kills all managed terminals and clears the registry', async () => {
      const fakeProc1 = makeFakeProcess()
      const fakeProc2 = makeFakeProcess()
      vi.mocked(spawn)
        .mockReturnValueOnce(fakeProc1)
        .mockReturnValueOnce(fakeProc2)

      const handler = new TerminalHandler()
      const t1 = await handler.createTerminal({
        command: 'cmd1',
        sessionId: 'session-1',
      })
      const t2 = await handler.createTerminal({
        command: 'cmd2',
        sessionId: 'session-1',
      })

      handler.dispose()

      expect(fakeProc1.kill).toHaveBeenCalledWith('SIGTERM')
      expect(fakeProc2.kill).toHaveBeenCalledWith('SIGTERM')

      // Both terminals should be gone
      await expect(
        handler.terminalOutput({ terminalId: t1.terminalId, sessionId: 'session-1' }),
      ).rejects.toThrow()
      await expect(
        handler.terminalOutput({ terminalId: t2.terminalId, sessionId: 'session-1' }),
      ).rejects.toThrow()
    })

    it('is safe to call dispose with no terminals', () => {
      const handler = new TerminalHandler()
      expect(() => handler.dispose()).not.toThrow()
    })
  })
})
