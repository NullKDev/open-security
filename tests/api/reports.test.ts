/**
 * tests/api/reports.test.ts
 * Tests for GET /api/reports/[scanId]
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'

let testDb: ReturnType<typeof createTestDb>

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...mod, getDb: () => testDb }
})

import { GET } from '@/app/api/reports/[scanId]/route'

function makeFinding(db: ReturnType<typeof createTestDb>, scanId: string) {
  return insertFinding(db, {
    scanId,
    detector: 'gitleaks',
    severity: 'high',
    confidence: 0.95,
    title: 'Hardcoded secret',
    description: 'AWS key found in source',
    locationPath: 'src/config.ts',
    locationLineStart: 42,
  })
}

describe('GET /api/reports/[scanId]', () => {
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    testDb = createTestDb(sqlite)
    vi.clearAllMocks()

    const project = createProject(testDb, { name: 'test', sourceKind: 'github', sourceRef: 'url' })
    const scan = createScan(testDb, { projectId: project.id })
    scanId = scan.id

    makeFinding(testDb, scanId)
    makeFinding(testDb, scanId)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 404 for non-existent scan', async () => {
    const req = new Request('http://localhost/api/reports/nonexistent')
    const res = await GET(req, { params: Promise.resolve({ scanId: 'nonexistent' }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 400 for invalid format', async () => {
    const req = new Request(`http://localhost/api/reports/${scanId}?format=xml`)
    const res = await GET(req, { params: Promise.resolve({ scanId }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns JSON report by default', async () => {
    const req = new Request(`http://localhost/api/reports/${scanId}`)
    const res = await GET(req, { params: Promise.resolve({ scanId }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const body = await res.json()
    expect(body.scan).toBeDefined()
    expect(Array.isArray(body.findings)).toBe(true)
    expect(body.findings.length).toBe(2)
  })

  it('returns markdown for format=md', async () => {
    const req = new Request(`http://localhost/api/reports/${scanId}?format=md`)
    const res = await GET(req, { params: Promise.resolve({ scanId }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')

    const text = await res.text()
    expect(text).toContain('---')
    expect(text).toContain(scanId)
  })

  it('returns CSV for format=csv', async () => {
    const req = new Request(`http://localhost/api/reports/${scanId}?format=csv`)
    const res = await GET(req, { params: Promise.resolve({ scanId }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')

    const text = await res.text()
    expect(text).toContain('id,title,severity')
  })

  it('returns SARIF for format=sarif', async () => {
    const req = new Request(`http://localhost/api/reports/${scanId}?format=sarif`)
    const res = await GET(req, { params: Promise.resolve({ scanId }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const body = await res.json()
    expect(body.version).toBe('2.1.0')
    expect(body.$schema).toBeDefined()
    expect(Array.isArray(body.runs)).toBe(true)
  })
})
