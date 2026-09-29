/**
 * tests/unit/exporters/github-code-scanning.test.ts
 *
 * TDD RED → GREEN: T-036 + T-037 — GitHub Code Scanning SARIF upload
 *
 * Covers:
 * - SARIF serialization produces valid structure (has runs[0].results)
 * - gzip + base64 round-trip
 * - Mock POST returns upload URL; poll until processing_status='complete'
 * - 3-retry exponential backoff on 5xx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { gunzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { eq } from 'drizzle-orm'
import { findings } from '@/lib/db/schema'
import { uploadSarif } from '@/lib/exporters/github-code-scanning'

const ENV_KEYS = ['OBT_GITHUB_PAT', 'OBT_GITHUB_OWNER', 'OBT_GITHUB_REPO']

function setGithubEnv() {
  process.env.OBT_GITHUB_PAT = 'ghp_test'
  process.env.OBT_GITHUB_OWNER = 'test-owner'
  process.env.OBT_GITHUB_REPO = 'test-repo'
}

function clearGithubEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

describe('uploadSarif', () => {
  let db: ReturnType<typeof createTestDb>
  let scanId: string

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    clearGithubEnv()

    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    scanId = scan.id

    insertFinding(db, {
      scanId,
      detector: 'gitleaks',
      severity: 'high',
      confidence: 0.9,
      title: 'Hardcoded key',
      description: 'AWS key in config.ts',
      locationPath: 'config.ts',
      locationLineStart: 42,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearGithubEnv()
  })

  it('throws config error when GitHub credentials are missing', async () => {
    await expect(uploadSarif(scanId, db)).rejects.toThrow(/not configured/i)
  })

  it('posts gzip+base64 encoded SARIF and polls until complete', async () => {
    setGithubEnv()
    vi.useFakeTimers()

    let capturedSarif: string | undefined

    const globalFetch = vi.fn()
      // POST /code-scanning/sarifs → upload URL
      .mockImplementationOnce(async (_url: string, opts: RequestInit) => {
        capturedSarif = (opts.body as string)
        return {
          ok: true,
          status: 202,
          json: async () => ({ id: 'sarif-upload-1', url: 'https://api.github.com/repos/test-owner/test-repo/code-scanning/sarifs/sarif-upload-1' }),
        }
      })
      // GET poll → processing
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ processing_status: 'pending' }),
      })
      // GET poll → complete
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ processing_status: 'complete' }),
      })

    vi.stubGlobal('fetch', globalFetch)

    const promise = uploadSarif(scanId, db)
    await vi.runAllTimersAsync()
    await promise

    // Verify the SARIF body was gzip+base64 encoded
    expect(capturedSarif).toBeTruthy()
    const parsedBody = JSON.parse(capturedSarif!)
    expect(parsedBody.sarif).toBeTruthy() // base64 encoded

    // Decode and gunzip to verify it's valid SARIF JSON
    const compressed = Buffer.from(parsedBody.sarif, 'base64')
    const decompressed = gunzipSync(compressed)
    const sarifDoc = JSON.parse(decompressed.toString('utf-8'))
    expect(sarifDoc.version).toBe('2.1.0')
    expect(Array.isArray(sarifDoc.runs)).toBe(true)
    expect(Array.isArray(sarifDoc.runs[0].results)).toBe(true)

    vi.useRealTimers()
  })

  it('persists sarifLastUploadedAt after success', async () => {
    setGithubEnv()
    vi.useFakeTimers()

    const globalFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ id: 'sarif-1', url: 'https://api.github.com/repos/test-owner/test-repo/code-scanning/sarifs/sarif-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ processing_status: 'complete' }),
      })

    vi.stubGlobal('fetch', globalFetch)

    const promise = uploadSarif(scanId, db)
    await vi.runAllTimersAsync()
    await promise

    // Verify at least one finding has sarifLastUploadedAt set
    const rows = db.select({ sarifLastUploadedAt: findings.sarifLastUploadedAt }).from(findings).where(eq(findings.scanId, scanId)).all()
    expect(rows.some((r) => r.sarifLastUploadedAt)).toBe(true)

    vi.useRealTimers()
  })

  it('retries up to 3 times on 5xx then succeeds', async () => {
    setGithubEnv()
    vi.useFakeTimers()

    const globalFetch = vi.fn()
      // 3 failing POSTs then success
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ id: 'sarif-retry', url: 'https://api.github.com/repos/test-owner/test-repo/code-scanning/sarifs/sarif-retry' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ processing_status: 'complete' }),
      })

    vi.stubGlobal('fetch', globalFetch)

    const promise = uploadSarif(scanId, db)
    await vi.runAllTimersAsync()
    await promise

    // 3 failures + 1 success = 4 POST calls, plus 1 poll
    expect(globalFetch).toHaveBeenCalledTimes(5)

    vi.useRealTimers()
  })

  it('throws after exhausting 3 retries on 5xx', async () => {
    setGithubEnv()
    vi.useFakeTimers()

    const globalFetch = vi.fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    vi.stubGlobal('fetch', globalFetch)

    const promise = uploadSarif(scanId, db)
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow(/GitHub/i)

    vi.useRealTimers()
  })
})
