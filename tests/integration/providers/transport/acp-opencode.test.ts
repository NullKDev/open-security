/**
 * Integration test: opencode ACP connection smoke test.
 *
 * Verifies that the full ACP lifecycle works with a real opencode binary:
 *   spawn → initialize → newSession → prompt → response → cleanup.
 *
 * Marked as .int.test.ts so it can be excluded from fast unit test runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnLoginShell, type SpawnResult } from '@/lib/providers/transport/spawn-shell'
import { ConnectionManager } from '@/lib/providers/transport/connection-manager'
import type { SessionNotification } from '@agentclientprotocol/sdk'
import * as os from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

describe('opencode ACP smoke test', () => {
  let spawned: SpawnResult | null = null
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'obt-acp-test-'))
  })

  afterAll(() => {
    spawned?.kill()
    try { rmSync(tmpDir, { recursive: true }) } catch { /* ok */ }
  })

  it('connects, creates session, and responds to hello world', async () => {
    // 1. Spawn opencode in ACP mode
    spawned = spawnLoginShell('opencode', ['acp'], {
      cwd: tmpDir,
      onStderrLine: (line) => {
        // Log stderr for debugging but don't fail on it
        if (line.trim()) console.log('[opencode stderr]', line)
      },
    })

    // 2. Connect via ConnectionManager
    const cm = new ConnectionManager()
    const { connection } = await cm.connect('test-opencode', {
      stdout: spawned.process.stdout!,
      stdin: spawned.process.stdin!,
    })

    // 3. Create a session
    const nsRes = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    })
    expect(nsRes.sessionId).toBeTruthy()
    console.log('Session created:', nsRes.sessionId)

    // 4. Send a hello world prompt
    const promptPromise = connection.prompt({
      sessionId: nsRes.sessionId,
      prompt: [{ type: 'text' as const, text: 'Say exactly: hello world. No other text.' }],
    })

    // 5. Collect session updates while prompt is running
    const updates: SessionNotification[] = []
    const updatePromise = new Promise<void>((resolve) => {
      // Listen for session updates on the client
      const info = cm.getConnection('test-opencode')
      if (!info) throw new Error('Connection not found')

      const originalOnEvent = info.client.onEvent
      info.client.onEvent = (ev) => {
        if (ev.type !== 'done') {
          updates.push(ev as unknown as SessionNotification)
        }
        originalOnEvent?.(ev)
        // Resolve after collecting a few updates — prompt will finish soon
      }
      resolve()
    })

    await updatePromise

    // 6. Wait for prompt to complete
    const promptResponse = await promptPromise
    console.log('Prompt response stopReason:', promptResponse.stopReason)
    console.log('Updates received:', updates.length)

    // 7. Verify we got something back
    expect(promptResponse.stopReason).toBeTruthy()
    expect(updates.length).toBeGreaterThan(0)
    console.log('✅ ACP connection to opencode works!')

    // 8. Cleanup
    cm.dispose()
  }, 30000) // 30 second timeout for real process
})
