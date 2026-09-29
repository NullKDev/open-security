/**
 * orchestrator.ts — Scan pipeline orchestrator
 *
 * Forks worker.ts as a child process, wires ScanBus from IPC events,
 * writes DB rows per event, and marks the scan as failed on unexpected exit.
 */
import { fork, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/lib/db/schema'
import { createScanBus } from './scan-bus'
import type { ScanBus } from './scan-bus'
import type { ScanEvent } from './events'
import { updateScanStatus } from '@/lib/repos/scans.repo'

type DB = BetterSQLite3Database<typeof schema>

export interface OrchestratorOpts {
  db: DB
  scanId: string
  projectId: string
  sourceKind: string
  sourceRef: string
  workspaceRoot: string
  /** Path to the compiled worker script. Default: worker.js next to this file. */
  workerPath?: string
  /** Injected bus for testing */
  bus?: ScanBus
  /** Called once the scan reaches done or failed */
  onComplete?: (scanId: string, status: 'done' | 'failed') => void
}

export interface OrchestratorHandle {
  /** The scan bus for subscribing to events */
  bus: ScanBus
  /** Promise that resolves when the worker exits */
  done: Promise<void>
  /** Terminate the worker immediately */
  abort: () => void
}

/**
 * Fork the worker and orchestrate the scan pipeline.
 *
 * Returns a handle with the ScanBus and a `done` promise.
 * The caller can subscribe to the bus for SSE or other consumers.
 */
export function startScan(opts: OrchestratorOpts): OrchestratorHandle {
  const {
    db,
    scanId,
    sourceKind,
    sourceRef,
    workspaceRoot,
    workerPath,
    onComplete,
  } = opts

  const bus = opts.bus ?? createScanBus()

  const resolvedWorkerPath =
    workerPath ?? path.join(__dirname, 'worker.js')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OBT_SCAN_ID: scanId,
    OBT_SOURCE_KIND: sourceKind,
    OBT_SOURCE_REF: sourceRef,
    OBT_WORKSPACE: workspaceRoot,
  }

  const child: ChildProcess = fork(resolvedWorkerPath, [], {
    env,
    // Use IPC channel for event messages
    silent: false,
  })

  // Mark scan as running
  try {
    updateScanStatus(db, scanId, 'running')
  } catch {
    // DB might not be available in all test contexts
  }

  const done = new Promise<void>((resolve) => {
    child.on('message', (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const event = raw as ScanEvent

      // Publish to bus
      bus.publish(scanId, event)

      // Persist to DB
      persistEvent(db, scanId, event)

      if (event.type === 'done') {
        try {
          updateScanStatus(db, scanId, 'done')
        } catch {
          // Ignore DB errors
        }
        bus.destroy(scanId)
        onComplete?.(scanId, 'done')
        resolve()
      }
    })

    child.on('exit', (code, signal) => {
      if (code !== 0 || signal) {
        const reason = signal ? `killed by ${signal}` : `exit code ${code}`
        const errEvent: ScanEvent = {
          type: 'error',
          message: `Worker exited unexpectedly: ${reason}`,
        }
        bus.publish(scanId, errEvent)

        try {
          updateScanStatus(db, scanId, 'failed', reason)
        } catch {
          // Ignore DB errors
        }
        onComplete?.(scanId, 'failed')
        resolve()
      } else {
        // Clean exit (code 0, no signal) without done event — treat as complete
        try {
          updateScanStatus(db, scanId, 'done')
        } catch {
          // Ignore DB errors
        }
        bus.destroy(scanId)
        onComplete?.(scanId, 'done')
        resolve()
      }
    })

    child.on('error', (err) => {
      const errEvent: ScanEvent = {
        type: 'error',
        message: `Worker process error: ${err.message}`,
      }
      bus.publish(scanId, errEvent)

      try {
        updateScanStatus(db, scanId, 'failed', err.message)
      } catch {
        // Ignore DB errors
      }
      onComplete?.(scanId, 'failed')
      resolve()
    })
  })

  return {
    bus,
    done,
    abort: () => {
      child.kill('SIGTERM')
    },
  }
}

function persistEvent(db: DB, scanId: string, event: ScanEvent): void {
  try {
    switch (event.type) {
      case 'stage':
        // Update scan stage column
        db.update(schema.scans)
          .set({ stage: event.stage })
          .where(require('drizzle-orm').eq(schema.scans.id, scanId))
          .run()
        break

      case 'finding':
        // Insert finding into DB
        db.insert(schema.findings)
          .values({
            id: crypto.randomUUID(),
            scanId,
            detector: event.finding.detector,
            severity: event.finding.severity,
            confidence: 0.8,
            title: event.finding.title,
            description: event.finding.description,
            locationPath: event.finding.locationPath,
            locationLineStart: event.finding.locationLineStart,
            locationLineEnd: event.finding.locationLineEnd ?? null,
            createdAt: new Date().toISOString(),
          })
          .run()
        break

      default:
        break
    }
  } catch {
    // Non-critical — don't break event flow on DB errors
  }
}
