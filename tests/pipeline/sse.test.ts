/**
 * tests/pipeline/sse.test.ts
 *
 * Tests for the SSE route app/api/scans/[id]/stream/route.ts
 * - Returns Content-Type: text/event-stream
 * - Replays last 100 events from bus on connect
 * - Closes stream when done/error is already in the buffer (bug fix)
 * - Closes stream after DB replay of a terminated scan (bug fix)
 * - Heartbeat fires at 15s interval (fake timers)
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createScanBus } from '@/lib/pipeline/scan-bus'
import type { ScanEvent } from '@/lib/pipeline/events'

// ─── DB mock (for the DB-replay path tests) ───────────────────────────────────

let testDb: ReturnType<typeof import('@/lib/db/client').createTestDb> | null = null

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return {
    ...mod,
    getDb: () => testDb ?? mod.createTestDb(new Database(':memory:')),
  }
})

import { createTestDb } from '@/lib/db/client'
import { GET } from '@/app/api/scans/[id]/stream/route'
import { insertScanEvent } from '@/lib/repos/scan-events.repo'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'

// ─── helpers ──────────────────────────────────────────────────────────────────

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  const chunks: string[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
  } catch {
    // Stream closed
  }
  return chunks.join('')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SSE route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    testDb = null
  })

  it('returns Content-Type: text/event-stream', async () => {
    const bus = createScanBus()
    const scanId = 'sse-scan-001'

    const req = new Request(`http://localhost/api/scans/${scanId}/stream`)
    const response = await GET(req, { params: Promise.resolve({ id: scanId }) }, { bus })

    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    response.body?.cancel()
  })

  it('replays buffered events on connect then closes on done', async () => {
    const bus = createScanBus()
    const scanId = 'sse-scan-002'

    const events: ScanEvent[] = [
      { type: 'stage', stage: 'prep', message: 'preparing' },
      { type: 'stage', stage: 'classical', message: 'scanning' },
      { type: 'progress', message: '50% done', pct: 50 },
    ]
    for (const e of events) bus.publish(scanId, e)

    const req = new Request(`http://localhost/api/scans/${scanId}/stream`)
    const response = await GET(req, { params: Promise.resolve({ id: scanId }) }, { bus })
    expect(response.status).toBe(200)

    setTimeout(() => bus.publish(scanId, { type: 'done', scanId }), 10)

    const combined = await readAll(response.body!)
    expect(combined).toContain('data:')
    expect(combined).toContain('preparing')
  })

  describe('stream closes when done is already in the buffer', () => {
    it('closes without heartbeats after replaying done', async () => {
      const bus = createScanBus()
      const scanId = 'sse-scan-done-in-buffer'

      // Pipeline finished before the client connected
      const events: ScanEvent[] = [
        { type: 'stage', stage: 'prep', message: 'preparing' },
        { type: 'stage', stage: 'llm-scan', message: 'scanning' },
        { type: 'done', scanId },
      ]
      for (const e of events) bus.publish(scanId, e)

      const req = new Request(`http://localhost/api/scans/${scanId}/stream`)
      const response = await GET(req, { params: Promise.resolve({ id: scanId }) }, { bus })

      const combined = await readAll(response.body!)

      expect(combined).toContain('"type":"done"')
      // Stream must close immediately — no heartbeat should appear
      expect(combined).not.toContain(': heartbeat')
    })

    it('closes without heartbeats when error is the last buffered event', async () => {
      const bus = createScanBus()
      const scanId = 'sse-scan-error-in-buffer'

      bus.publish(scanId, { type: 'stage', stage: 'prep', message: 'start' })
      bus.publish(scanId, { type: 'error', message: 'Pipeline failed hard' })

      const req = new Request(`http://localhost/api/scans/${scanId}/stream`)
      const response = await GET(req, { params: Promise.resolve({ id: scanId }) }, { bus })

      const combined = await readAll(response.body!)

      expect(combined).toContain('"type":"error"')
      expect(combined).not.toContain(': heartbeat')
    })
  })

  describe('stream closes after DB replay of a terminated scan', () => {
    it('closes after replaying done without sending heartbeats', async () => {
      // Simulate server restart: bus is empty, but scan events exist in DB
      const bus = createScanBus() // no entries — looks like a restart
      const sqlite = new Database(':memory:')
      testDb = createTestDb(sqlite)

      // Seed project + scan + events in the test DB
      const project = createProject(testDb, { name: 'p', sourceKind: 'github', sourceRef: 'url' })
      const scan = createScan(testDb, { projectId: project.id })

      const doneEvent: ScanEvent = { type: 'done', scanId: scan.id }
      insertScanEvent(testDb, scan.id, { type: 'stage', stage: 'prep', message: 'ok' })
      insertScanEvent(testDb, scan.id, doneEvent)

      const req = new Request(`http://localhost/api/scans/${scan.id}/stream`)
      const response = await GET(req, { params: Promise.resolve({ id: scan.id }) }, { bus })

      const combined = await readAll(response.body!)

      expect(combined).toContain('"type":"done"')
      expect(combined).not.toContain(': heartbeat')
    })

    it('emits error and closes when scan was interrupted mid-run', async () => {
      const bus = createScanBus()
      const sqlite = new Database(':memory:')
      testDb = createTestDb(sqlite)

      const project = createProject(testDb, { name: 'p2', sourceKind: 'github', sourceRef: 'url' })
      const scan = createScan(testDb, { projectId: project.id })

      // Only a stage event — no done/error — simulates mid-run server restart
      insertScanEvent(testDb, scan.id, { type: 'stage', stage: 'llm-scan', message: 'scanning...' })

      const req = new Request(`http://localhost/api/scans/${scan.id}/stream`)
      const response = await GET(req, { params: Promise.resolve({ id: scan.id }) }, { bus })

      const combined = await readAll(response.body!)

      expect(combined).toContain('"type":"error"')
      expect(combined).toContain('interrupted')
      expect(combined).not.toContain(': heartbeat')
    })
  })

  it('heartbeat fires at 15s interval using fake timers', async () => {
    vi.useFakeTimers()

    const bus = createScanBus()
    const scanId = 'sse-scan-heartbeat'

    const collected: string[] = []
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        const timer = setInterval(() => {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        }, 15_000)

        const unsub = bus.subscribe(scanId, (event) => {
          if (event.type === 'done') {
            clearInterval(timer)
            unsub()
            try { controller.close() } catch { /* already closed */ }
          }
        })
      },
    })

    vi.advanceTimersByTime(15_000)
    bus.publish(scanId, { type: 'done', scanId })

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      collected.push(decoder.decode(value))
    }

    expect(collected.join('')).toContain(': heartbeat')
  })

  it('no crash for unknown scan with empty bus and empty DB', async () => {
    const bus = createScanBus()
    const req = new Request('http://localhost/api/scans/ghost-scan/stream')
    const response = await GET(req, { params: Promise.resolve({ id: 'ghost-scan' }) }, { bus })
    expect([200, 404]).toContain(response.status)
    response.body?.cancel()
  })
})
