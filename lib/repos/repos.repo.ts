/**
 * lib/repos/repos.repo.ts
 *
 * CRUD operations for the `repos` table (v0.2: per-repo watch + webhook config).
 */

import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { repos } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface RepoDTO {
  id: string
  projectId: string | null
  name: string
  localPath: string
  defaultBranch: string
  watchEnabled: boolean
  watchInterval: string
  notifyChannels: string[] | null
  notifySeverityFloor: string
  slackWebhookUrlRef: string | null
  webhookSecretRef: string | null
  webhookProxyUrl: string | null
  createdAt: string
}

export interface CreateRepoInput {
  name: string
  localPath: string
  defaultBranch: string
  projectId?: string | null
  watchEnabled?: boolean
  watchInterval?: string
  notifyChannels?: string[] | null
  notifySeverityFloor?: string
  slackWebhookUrlRef?: string | null
  webhookSecretRef?: string | null
  webhookProxyUrl?: string | null
}

export interface UpdateRepoInput {
  name?: string
  localPath?: string
  defaultBranch?: string
  watchEnabled?: boolean
  watchInterval?: string
  notifyChannels?: string[] | null
  notifySeverityFloor?: string
  slackWebhookUrlRef?: string | null
  webhookSecretRef?: string | null
  webhookProxyUrl?: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof repos.$inferSelect): RepoDTO {
  let notifyChannels: string[] | null = null
  if (row.notifyChannels) {
    try {
      notifyChannels = JSON.parse(row.notifyChannels) as string[]
    } catch {
      notifyChannels = null
    }
  }
  return {
    id: row.id,
    projectId: row.projectId ?? null,
    name: row.name,
    localPath: row.localPath,
    defaultBranch: row.defaultBranch,
    watchEnabled: Boolean(row.watchEnabled),
    watchInterval: row.watchInterval,
    notifyChannels,
    notifySeverityFloor: row.notifySeverityFloor,
    slackWebhookUrlRef: row.slackWebhookUrlRef ?? null,
    webhookSecretRef: row.webhookSecretRef ?? null,
    webhookProxyUrl: row.webhookProxyUrl ?? null,
    createdAt: row.createdAt,
  }
}

/**
 * Insert a new repo row.
 *
 * @param db - Drizzle database instance
 * @param input - Repo fields
 * @returns Newly created RepoDTO
 */
export function createRepo(db: DB, input: CreateRepoInput): RepoDTO {
  const id = uuid()
  const now = new Date().toISOString()

  db.insert(repos).values({
    id,
    projectId: input.projectId ?? null,
    name: input.name,
    localPath: input.localPath,
    defaultBranch: input.defaultBranch,
    watchEnabled: input.watchEnabled ? 1 : 0,
    watchInterval: input.watchInterval ?? '0 */6 * * *',
    notifyChannels: input.notifyChannels ? JSON.stringify(input.notifyChannels) : null,
    notifySeverityFloor: input.notifySeverityFloor ?? 'high',
    slackWebhookUrlRef: input.slackWebhookUrlRef ?? null,
    webhookSecretRef: input.webhookSecretRef ?? null,
    webhookProxyUrl: input.webhookProxyUrl ?? null,
    createdAt: now,
  }).run()

  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  if (!row) throw new Error(`Failed to read back repo ${id}`)
  return rowToDTO(row)
}

/**
 * Get a single repo by ID.
 *
 * @param db - Drizzle database instance
 * @param id - Repo ID
 * @returns RepoDTO or null if not found
 */
export function getRepoById(db: DB, id: string): RepoDTO | null {
  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  return row ? rowToDTO(row) : null
}

/**
 * List all repos.
 *
 * @param db - Drizzle database instance
 * @returns Array of RepoDTO
 */
export function listRepos(db: DB): RepoDTO[] {
  const rows = db.select().from(repos).all()
  return rows.map(rowToDTO)
}

/**
 * List all repos with watch mode enabled.
 * Used by the watch scheduler to register cron jobs.
 *
 * @param db - Drizzle database instance
 * @returns Array of RepoDTO where watchEnabled = true
 */
export function listEnabledWatchRepos(db: DB): RepoDTO[] {
  const rows = db.select().from(repos).where(eq(repos.watchEnabled, 1)).all()
  return rows.map(rowToDTO)
}

/**
 * Update an existing repo's fields.
 *
 * @param db - Drizzle database instance
 * @param id - Repo ID to update
 * @param input - Fields to update (partial)
 * @returns Updated RepoDTO
 * @throws Error if repo not found
 */
export function updateRepo(db: DB, id: string, input: UpdateRepoInput): RepoDTO {
  const updateData: Record<string, unknown> = {}

  if (input.name !== undefined) updateData.name = input.name
  if (input.localPath !== undefined) updateData.localPath = input.localPath
  if (input.defaultBranch !== undefined) updateData.defaultBranch = input.defaultBranch
  if (input.watchEnabled !== undefined) updateData.watchEnabled = input.watchEnabled ? 1 : 0
  if (input.watchInterval !== undefined) updateData.watchInterval = input.watchInterval
  if (input.notifyChannels !== undefined) {
    updateData.notifyChannels = input.notifyChannels ? JSON.stringify(input.notifyChannels) : null
  }
  if (input.notifySeverityFloor !== undefined) updateData.notifySeverityFloor = input.notifySeverityFloor
  if (input.slackWebhookUrlRef !== undefined) updateData.slackWebhookUrlRef = input.slackWebhookUrlRef
  if (input.webhookSecretRef !== undefined) updateData.webhookSecretRef = input.webhookSecretRef
  if (input.webhookProxyUrl !== undefined) updateData.webhookProxyUrl = input.webhookProxyUrl

  db.update(repos).set(updateData).where(eq(repos.id, id)).run()

  const row = db.select().from(repos).where(eq(repos.id, id)).get()
  if (!row) throw new Error(`Repo ${id} not found after update`)
  return rowToDTO(row)
}

/**
 * Delete a repo by ID.
 *
 * @param db - Drizzle database instance
 * @param id - Repo ID to delete
 */
export function deleteRepo(db: DB, id: string): void {
  db.delete(repos).where(eq(repos.id, id)).run()
}
