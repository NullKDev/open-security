import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { webhookEvents } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/** Status values for a webhook event row */
export type WebhookEventStatus = 'pending' | 'processed' | 'failed'

export interface WebhookEventDTO {
  id: string
  repoId: string | null
  deliveryId: string | null
  event: string | null
  action: string | null
  payload: string
  status: WebhookEventStatus
  receivedAt: string
  processedAt: string | null
  scanId: string | null
  error: string | null
}

export interface InsertWebhookEventInput {
  payload: string
  deliveryId?: string | null
  event?: string | null
  action?: string | null
  repoId?: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof webhookEvents.$inferSelect): WebhookEventDTO {
  return {
    id: row.id,
    repoId: row.repoId ?? null,
    deliveryId: row.deliveryId ?? null,
    event: row.event ?? null,
    action: row.action ?? null,
    payload: row.payload,
    status: (row.status ?? 'pending') as WebhookEventStatus,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? null,
    scanId: row.scanId ?? null,
    error: row.error ?? null,
  }
}

/**
 * Insert a new webhook event row with status='pending'.
 * Throws if deliveryId violates the UNIQUE constraint (duplicate delivery).
 */
export function insertWebhookEvent(db: DB, input: InsertWebhookEventInput): WebhookEventDTO {
  const id = uuid()
  const now = new Date().toISOString()

  db.insert(webhookEvents).values({
    id,
    repoId: input.repoId ?? null,
    deliveryId: input.deliveryId ?? null,
    event: input.event ?? null,
    action: input.action ?? null,
    payload: input.payload,
    status: 'pending',
    receivedAt: now,
  }).run()

  const row = db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get()
  if (!row) throw new Error(`Failed to read back webhook event ${id}`)
  return rowToDTO(row)
}

/**
 * Retrieve a single webhook event by primary key.
 */
export function getWebhookEventById(db: DB, id: string): WebhookEventDTO | undefined {
  const row = db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get()
  return row ? rowToDTO(row) : undefined
}

/**
 * Return all pending webhook events ordered by received_at ascending.
 */
export function listPendingWebhookEvents(db: DB): WebhookEventDTO[] {
  const rows = db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.status, 'pending'))
    .all()
  return rows.map(rowToDTO)
}

/**
 * Mark a webhook event as processed. Sets processed_at and optionally associates a scan_id.
 */
export function markWebhookEventProcessed(db: DB, id: string, scanId: string | null): void {
  const now = new Date().toISOString()
  db.update(webhookEvents)
    .set({ status: 'processed', processedAt: now, scanId })
    .where(eq(webhookEvents.id, id))
    .run()
}

/**
 * Mark a webhook event as failed with an error message.
 */
export function markWebhookEventFailed(db: DB, id: string, error: string): void {
  const now = new Date().toISOString()
  db.update(webhookEvents)
    .set({ status: 'failed', processedAt: now, error })
    .where(eq(webhookEvents.id, id))
    .run()
}
