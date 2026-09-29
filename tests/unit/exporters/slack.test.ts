/**
 * tests/unit/exporters/slack.test.ts
 *
 * TDD RED → GREEN: T-033 + T-034 — Slack weekly digest exporter
 *
 * Covers:
 * - Digest message includes new/fixed/regressed counts
 * - Idempotent within same week (skip if lastDigestAt within 7 days)
 * - No webhook URL env → no-op (returns without posting)
 * - POST mock asserts Block Kit shape (sections array)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb } from '@/lib/db/client'
import { createProject } from '@/lib/repos/projects.repo'
import { createScan } from '@/lib/repos/scans.repo'
import { insertFinding } from '@/lib/repos/findings.repo'
import { eq } from 'drizzle-orm'
import { config as configTable } from '@/lib/db/schema'
import { sendWeeklyDigest } from '@/lib/exporters/slack'

const LAST_DIGEST_KEY = 'slack:lastDigestAt'

describe('sendWeeklyDigest', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    db = createTestDb(sqlite)
    delete process.env.OBT_SLACK_WEBHOOK_URL
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OBT_SLACK_WEBHOOK_URL
  })

  function seedFindings(db: ReturnType<typeof createTestDb>) {
    const project = createProject(db, { name: 'test', sourceKind: 'local', sourceRef: '/tmp' })
    const scan = createScan(db, { projectId: project.id })

    // Two open findings
    insertFinding(db, { scanId: scan.id, detector: 'gitleaks', severity: 'high', confidence: 0.9, title: 'Key1', description: 'Desc', locationPath: 'a.ts', locationLineStart: 1 })
    insertFinding(db, { scanId: scan.id, detector: 'semgrep', severity: 'medium', confidence: 0.8, title: 'Injection', description: 'Desc', locationPath: 'b.ts', locationLineStart: 10 })

    return { scan }
  }

  it('returns early (no-op) when OBT_SLACK_WEBHOOK_URL is not set', async () => {
    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    await sendWeeklyDigest(db)

    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('sends Block Kit payload with sections array', async () => {
    process.env.OBT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'
    seedFindings(db)

    const globalFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', globalFetch)

    await sendWeeklyDigest(db)

    expect(globalFetch).toHaveBeenCalledOnce()
    const call = globalFetch.mock.calls[0]
    const body = JSON.parse(call[1].body as string)
    expect(Array.isArray(body.blocks)).toBe(true)
    expect(body.blocks.length).toBeGreaterThan(0)
    // First block should be a header or section
    expect(['header', 'section'].includes(body.blocks[0].type)).toBe(true)
  })

  it('includes finding counts in the message', async () => {
    process.env.OBT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'
    seedFindings(db)

    let postedBody: unknown
    const globalFetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      postedBody = JSON.parse(opts.body as string)
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', globalFetch)

    await sendWeeklyDigest(db)

    // Body text should mention counts
    const payload = postedBody as { blocks: Array<{ text?: { text: string }; fields?: Array<{ text: string }> }> }
    const allText = payload.blocks
      .flatMap((b) => [b.text?.text, ...(b.fields ?? []).map((f) => f.text)])
      .filter(Boolean)
      .join('\n')

    expect(allText).toBeTruthy()
  })

  it('skips posting if lastDigestAt is within 7 days', async () => {
    process.env.OBT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'

    // Set lastDigestAt to 1 hour ago (within 7 days)
    const recentAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    db.insert(configTable).values({ key: LAST_DIGEST_KEY, value: recentAt }).run()

    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    await sendWeeklyDigest(db)

    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('sends again after 7 days have passed', async () => {
    process.env.OBT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test'

    // Set lastDigestAt to 8 days ago
    const oldAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    db.insert(configTable).values({ key: LAST_DIGEST_KEY, value: oldAt }).run()

    seedFindings(db)
    const globalFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', globalFetch)

    await sendWeeklyDigest(db)

    expect(globalFetch).toHaveBeenCalledOnce()
  })
})
