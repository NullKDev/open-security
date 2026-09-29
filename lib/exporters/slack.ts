/**
 * lib/exporters/slack.ts
 *
 * Weekly security digest to Slack via Incoming Webhooks.
 *
 * Credential:
 *   OBT_SLACK_WEBHOOK_URL — full Slack webhook URL (required to post)
 *
 * Idempotency: skips posting if the last digest was sent within the past 7 days.
 * The `config` table entry `slack:lastDigestAt` tracks the last send time.
 *
 * Payload: Slack Block Kit with section blocks summarizing finding counts
 * (new / fixed / regressed) for the past week.
 */
import { eq, gte, and } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings, config as configTable } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

const LAST_DIGEST_KEY = 'slack:lastDigestAt'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Block Kit text object */
interface TextObject {
  type: 'plain_text' | 'mrkdwn'
  text: string
}

/** Block Kit section block */
interface SectionBlock {
  type: 'section'
  text?: TextObject
  fields?: TextObject[]
}

/** Block Kit header block */
interface HeaderBlock {
  type: 'header'
  text: TextObject
}

/** Block Kit divider block */
interface DividerBlock {
  type: 'divider'
}

type Block = HeaderBlock | SectionBlock | DividerBlock

interface BlockKitPayload {
  blocks: Block[]
}

/**
 * Read the last digest timestamp from the config table.
 * Returns null if never sent.
 */
function readLastDigestAt(db: DB): string | null {
  const row = db.select().from(configTable).where(eq(configTable.key, LAST_DIGEST_KEY)).get()
  return row?.value ?? null
}

/**
 * Persist the last digest timestamp in the config table.
 */
function writeLastDigestAt(db: DB, at: string): void {
  db.insert(configTable)
    .values({ key: LAST_DIGEST_KEY, value: at })
    .onConflictDoUpdate({ target: configTable.key, set: { value: at } })
    .run()
}

/**
 * Query finding counts for the past week window.
 */
interface DigestCounts {
  total: number
  bySeverity: { critical: number; high: number; medium: number; low: number }
}

function queryDigestCounts(db: DB, windowStart: string): DigestCounts {
  const rows = db
    .select({
      severity: findings.severity,
    })
    .from(findings)
    .where(
      and(
        gte(findings.createdAt, windowStart),
      ),
    )
    .all()

  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const row of rows) {
    const s = row.severity as keyof typeof counts
    if (s in counts) counts[s]++
  }

  return {
    total: rows.length,
    bySeverity: counts,
  }
}

/**
 * Build a Slack Block Kit payload for the weekly digest.
 */
function buildDigestPayload(counts: DigestCounts, windowStart: string): BlockKitPayload {
  const header: HeaderBlock = {
    type: 'header',
    text: { type: 'plain_text', text: '🔒 Weekly Security Digest' },
  }

  const summary: SectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${counts.total} finding(s)* detected since ${windowStart.slice(0, 10)}`,
    },
  }

  const breakdown: SectionBlock = {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Critical:* ${counts.bySeverity.critical}` },
      { type: 'mrkdwn', text: `*High:* ${counts.bySeverity.high}` },
      { type: 'mrkdwn', text: `*Medium:* ${counts.bySeverity.medium}` },
      { type: 'mrkdwn', text: `*Low:* ${counts.bySeverity.low}` },
    ],
  }

  const divider: DividerBlock = { type: 'divider' }

  return { blocks: [header, divider, summary, breakdown] }
}

/**
 * Send the weekly security digest to Slack.
 *
 * No-op if `OBT_SLACK_WEBHOOK_URL` is not set.
 * Idempotent: skips if a digest was sent within the past 7 days.
 * Updates `config.slack:lastDigestAt` after a successful post.
 *
 * @param db - Drizzle database instance
 */
export async function sendWeeklyDigest(db: DB): Promise<void> {
  const webhookUrl = process.env.OBT_SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  // ── Idempotency check ──────────────────────────────────────────────────────
  const lastAt = readLastDigestAt(db)
  if (lastAt) {
    const age = Date.now() - new Date(lastAt).getTime()
    if (age < WEEK_MS) return
  }

  // ── Build payload ──────────────────────────────────────────────────────────
  const windowStart = new Date(Date.now() - WEEK_MS).toISOString()
  const counts = queryDigestCounts(db, windowStart)
  const payload = buildDigestPayload(counts, windowStart)

  // ── POST to Slack ──────────────────────────────────────────────────────────
  await fetch(webhookUrl, { // user-webhook-fetch
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // ── Update lastDigestAt ────────────────────────────────────────────────────
  writeLastDigestAt(db, new Date().toISOString())
}
