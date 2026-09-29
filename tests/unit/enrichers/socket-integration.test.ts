/**
 * tests/unit/enrichers/socket-integration.test.ts
 *
 * TDD RED → GREEN: T-023 — Socket enricher wired into enrichment service
 *
 * Covers:
 * - enrichScan calls Socket enricher for osv-scanner findings
 * - Socket finding rows created in findings table with detector='socket'
 * - Socket findings have correct tag from alert type
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { eq } from 'drizzle-orm'
import { findings } from '@/lib/db/schema'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  process.env['OBT_SOCKET_API_KEY'] = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['OBT_SOCKET_API_KEY']
})

describe('enrichScan with Socket integration', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)

    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    scanId = scan.id
  })

  it('persists socket:malware finding when osv-scanner finding has npm package metadata', async () => {
    // Insert an osv-scanner finding with npm package info in description
    insertFinding(db, {
      scanId,
      detector: 'osv-scanner',
      severity: 'high',
      confidence: 1.0,
      title: 'Malicious npm package: evil-pkg@1.0.0',
      description: 'Package: evil-pkg, Version: 1.0.0, Ecosystem: npm',
      locationPath: 'package-lock.json',
      locationLineStart: 1,
      tags: [{ ecosystem: 'npm', name: 'evil-pkg', version: '1.0.0' }],
    })

    // Mock Socket API response with malware alert
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        alerts: [{ type: 'malware' }],
      }),
    })

    // Also mock KEV and EPSS since enrichScan calls them
    // (we'll mock the whole enrichScan module and call the wired version directly)
    const { enrichScanWithSocket } = await import('@/lib/enrichment/service')
    await enrichScanWithSocket(db, scanId)

    // Check that a socket finding was created
    const socketFindings = db
      .select()
      .from(findings)
      .where(eq(findings.detector, 'socket'))
      .all()

    expect(socketFindings).toHaveLength(1)
    expect(socketFindings[0]?.title).toContain('socket:malware')
  })

  it('creates no socket findings when osv-scanner findings have no package tags', async () => {
    // Insert a finding without package tags
    insertFinding(db, {
      scanId,
      detector: 'semgrep',
      severity: 'high',
      confidence: 0.9,
      title: 'SQL injection',
      description: 'Code issue',
      locationPath: 'src/db.ts',
      locationLineStart: 10,
    })

    const { enrichScanWithSocket } = await import('@/lib/enrichment/service')
    await enrichScanWithSocket(db, scanId)

    const socketFindings = db
      .select()
      .from(findings)
      .where(eq(findings.detector, 'socket'))
      .all()

    expect(socketFindings).toHaveLength(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
