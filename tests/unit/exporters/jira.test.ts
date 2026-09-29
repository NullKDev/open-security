/**
 * tests/unit/exporters/jira.test.ts
 *
 * TDD RED → GREEN: T-031 + T-032 — Jira exporter
 *
 * Covers:
 * - Creates Jira ticket and returns key
 * - Idempotent re-export returns existing key (no second POST)
 * - Missing credentials (OBT_JIRA_BASE_URL etc.) throws config error
 * - 429 → retries with backoff (mock 429 then 200)
 * - 4xx (non-429) writes last_export_error to DB
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { findings } from '@/lib/db/schema'
import { exportToJira } from '@/lib/exporters/jira'

describe('exportToJira', () => {
  let db: ReturnType<typeof createTestDb>
  let findingId: string

  const ENV_KEYS = [
    'OBT_JIRA_BASE_URL',
    'OBT_JIRA_PROJECT_KEY',
    'OBT_JIRA_EMAIL',
    'OBT_JIRA_API_TOKEN',
  ]

  function setJiraEnv() {
    process.env.OBT_JIRA_BASE_URL = 'https://test.atlassian.net'
    process.env.OBT_JIRA_PROJECT_KEY = 'SEC'
    process.env.OBT_JIRA_EMAIL = 'test@example.com'
    process.env.OBT_JIRA_API_TOKEN = 'token123'
  }

  function clearJiraEnv() {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
  }

  function makeFinding(db: ReturnType<typeof createTestDb>) {
    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })
    return insertFinding(db, {
      scanId: scan.id,
      detector: 'gitleaks',
      severity: 'high',
      confidence: 0.9,
      title: 'Hardcoded API key',
      description: 'AWS key in config.ts',
      locationPath: 'config.ts',
      locationLineStart: 42,
    })
  }

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    clearJiraEnv()
    const finding = makeFinding(db)
    findingId = finding.id
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearJiraEnv()
  })

  it('creates Jira ticket and returns issue key', async () => {
    setJiraEnv()

    const globalFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ key: 'SEC-123' }),
    })
    vi.stubGlobal('fetch', globalFetch)

    const key = await exportToJira(findingId, db)

    expect(key).toBe('SEC-123')
    expect(globalFetch).toHaveBeenCalledOnce()

    // Verify persisted in DB
    const row = db.select({ jiraIssueKey: findings.jiraIssueKey }).from(findings).where(eq(findings.id, findingId)).get()
    expect(row?.jiraIssueKey).toBe('SEC-123')
  })

  it('returns existing key without re-posting (idempotent)', async () => {
    setJiraEnv()

    // Pre-set jira_issue_key
    db.update(findings).set({ jiraIssueKey: 'SEC-99' }).where(eq(findings.id, findingId)).run()

    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const key = await exportToJira(findingId, db)

    expect(key).toBe('SEC-99')
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('throws config error when credentials are missing', async () => {
    await expect(exportToJira(findingId, db)).rejects.toThrow(/not configured/i)
  })

  it('retries on 429 and succeeds on second call', async () => {
    setJiraEnv()
    vi.useFakeTimers()

    const globalFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ key: 'SEC-200' }) })

    vi.stubGlobal('fetch', globalFetch)

    const promise = exportToJira(findingId, db)
    await vi.runAllTimersAsync()
    const key = await promise

    expect(key).toBe('SEC-200')
    expect(globalFetch).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('writes last_export_error on 4xx (non-429)', async () => {
    setJiraEnv()

    const globalFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ errorMessages: ['Forbidden'] }),
    })
    vi.stubGlobal('fetch', globalFetch)

    await expect(exportToJira(findingId, db)).rejects.toThrow()

    const row = db.select({ lastExportError: findings.lastExportError }).from(findings).where(eq(findings.id, findingId)).get()
    expect(row?.lastExportError).toBeTruthy()
    const err = JSON.parse(row!.lastExportError!)
    expect(err.target).toBe('jira')
    expect(err.message).toBeTruthy()
  })
})
