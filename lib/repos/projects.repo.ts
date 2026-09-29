import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { projects } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface ProjectDTO {
  id: string
  name: string
  sourceKind: string
  sourceRef: string
  /** JSON snapshot of the model config at project creation time */
  modelsConfig: string | null
  createdAt: string
}

export interface CreateProjectInput {
  name: string
  sourceKind: string
  sourceRef: string
  /** JSON snapshot of current model config (from readConfig().models) */
  modelsConfig?: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

export function createProject(db: DB, input: CreateProjectInput): ProjectDTO {
  const id = uuid()
  const now = new Date().toISOString()
  db.insert(projects).values({
    id,
    name: input.name,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    modelsConfig: input.modelsConfig ?? null,
    createdAt: now,
  }).run()
  return {
    id,
    name: input.name,
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    modelsConfig: input.modelsConfig ?? null,
    createdAt: now,
  }
}

export function getProjectById(db: DB, id: string): ProjectDTO | undefined {
  const row = db.select().from(projects).where(eq(projects.id, id)).get()
  if (!row) return undefined
  return {
    id: row.id,
    name: row.name,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    modelsConfig: row.modelsConfig ?? null,
    createdAt: row.createdAt,
  }
}

export function listProjects(db: DB): ProjectDTO[] {
  const rows = db.select().from(projects).all()
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    modelsConfig: row.modelsConfig ?? null,
    createdAt: row.createdAt,
  }))
}
