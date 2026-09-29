import { eq, and, lt, or, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings, findingStatusSchema } from '@/lib/db/schema'
import type { FindingStatus } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { computeDedupKey } from '@/lib/dedup/dedup-key'

// Re-export for consumers that need the status type
export { findingStatusSchema }
export type { FindingStatus }

type DB = BetterSQLite3Database<typeof schema>

export interface FindingDTO {
  id: string
  scanId: string
  detector: string
  severity: string
  confidence: number
  exploitability: number
  title: string
  description: string
  locationPath: string
  locationLineStart: number
  locationLineEnd: number | null
  locationCommit: string | null
  dataFlow: unknown | null
  evidenceHistory: unknown | null
  patchDiff: string | null
  patchExplanation: string | null
  patchContext: string | null
  patchGeneratedAt: string | null
  validationModel: string | null
  validationPasses: boolean | null
  validationRationale: string | null
  fpFiltered: boolean
  tags: unknown | null
  createdAt: string
  // v0.1 dedup + enrichment
  dedupKey: string | null
  canonicalFindingId: string | null
  cveIds: string[] | null
  firstDetectedAt: string | null
  lastSeenAt: string | null
  occurrenceCount: number
  // v0.4 status + Fix & Prove + regression
  /** Lifecycle status, validated via findingStatusSchema. Null for pre-v0.4 rows (treat as 'open'). */
  status: FindingStatus | null
  /** FK to the latest fix_proofs row (denormalized for queue query perf) */
  proofOfFixId: string | null
  /** Whether this finding is a regression of a previously merged fix */
  isRegression: boolean
  /** FK to the original finding that was supposedly fixed and regressed */
  regressionOfFindingId: string | null
}

export interface CreateFindingInput {
  scanId: string
  detector: string
  severity: string
  confidence: number
  exploitability?: number
  title: string
  description?: string
  locationPath: string
  locationLineStart: number
  locationLineEnd?: number | null
  locationCommit?: string | null
  dataFlow?: unknown | null
  evidenceHistory?: unknown | null
  patchDiff?: string | null
  patchExplanation?: string | null
  patchContext?: string | null
  patchGeneratedAt?: string | null
  validationModel?: string | null
  validationPasses?: boolean | null
  validationRationale?: string | null
  fpFiltered?: boolean
  tags?: unknown | null
}

export interface UpdateFindingInput {
  severity?: string
  confidence?: number
  exploitability?: number
  title?: string
  description?: string
  patchDiff?: string | null
  patchExplanation?: string | null
  patchContext?: string | null
  patchGeneratedAt?: string | null
  validationModel?: string | null
  validationPasses?: boolean | null
  validationRationale?: string | null
  fpFiltered?: boolean
  tags?: unknown | null
  // v0.4 fields
  status?: FindingStatus
  proofOfFixId?: string | null
  isRegression?: boolean
  regressionOfFindingId?: string | null
}

export interface ListFindingsResult {
  findings: FindingDTO[]
  nextCursor: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

function encodeCursor(id: string, createdAt: string): string {
  return Buffer.from(JSON.stringify({ id, createdAt })).toString('base64')
}

function decodeCursor(cursor: string): { id: string; createdAt: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
    if (typeof parsed.id === 'string' && typeof parsed.createdAt === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

function rowToDTO(row: typeof findings.$inferSelect): FindingDTO {
  // Parse and validate status — Zod parse crashes early on invalid values (ADR-8)
  let status: FindingStatus | null = null
  if (row.status != null) {
    const parsed = findingStatusSchema.safeParse(row.status)
    if (parsed.success) {
      status = parsed.data
    } else {
      // Unknown status value — surface as null and let consumers handle gracefully
      status = null
    }
  }

  return {
    id: row.id,
    scanId: row.scanId,
    detector: row.detector,
    severity: row.severity,
    confidence: row.confidence,
    exploitability: row.exploitability,
    title: row.title,
    description: row.description,
    locationPath: row.locationPath,
    locationLineStart: row.locationLineStart,
    locationLineEnd: row.locationLineEnd ?? null,
    locationCommit: row.locationCommit ?? null,
    dataFlow: row.dataFlow ? safeJsonParse(row.dataFlow) : null,
    evidenceHistory: row.evidenceHistory ? safeJsonParse(row.evidenceHistory) : null,
    patchDiff: row.patchDiff ?? null,
    patchExplanation: row.patchExplanation ?? null,
    patchContext: row.patchContext ?? null,
    patchGeneratedAt: row.patchGeneratedAt ?? null,
    validationModel: row.validationModel ?? null,
    validationPasses: row.validationPasses ?? null,
    validationRationale: row.validationRationale ?? null,
    fpFiltered: row.fpFiltered,
    tags: row.tags ? safeJsonParse(row.tags) : null,
    createdAt: row.createdAt,
    // v0.1 dedup + enrichment
    dedupKey: row.dedupKey ?? null,
    canonicalFindingId: row.canonicalFindingId ?? null,
    cveIds: row.cveIds ? (safeJsonParse(row.cveIds) as string[]) : null,
    firstDetectedAt: row.firstDetectedAt ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
    occurrenceCount: row.occurrenceCount,
    // v0.4 status + Fix & Prove + regression
    status,
    proofOfFixId: row.proofOfFixId ?? null,
    isRegression: row.isRegression === 1,
    regressionOfFindingId: row.regressionOfFindingId ?? null,
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * Inserts a finding with dedup upsert logic.
 *
 * If a canonical row with the same `dedup_key` already exists (canonical_finding_id IS NULL),
 * the new finding is inserted with `canonical_finding_id` pointing to that row, and the
 * canonical's `occurrence_count` and `last_seen_at` are updated.
 *
 * If no canonical exists, the finding is inserted as the canonical row.
 *
 * @param db - Drizzle database instance
 * @param input - Finding creation input
 * @returns The inserted FindingDTO (the new row, not the canonical)
 */
export function insertFinding(db: DB, input: CreateFindingInput): FindingDTO {
  const id = uuid()
  const now = new Date().toISOString()

  const dedupKey = computeDedupKey(input.detector, input.locationPath, input.title)

  // Wrap in transaction for atomic dedup check + insert
  db.transaction((tx) => {
    // Find existing canonical row with same dedup_key
    const canonical = tx
      .select()
      .from(findings)
      .where(
        and(
          eq(findings.dedupKey, dedupKey),
          isNull(findings.canonicalFindingId),
        ),
      )
      .get()

    if (canonical) {
      // Insert as duplicate linking to canonical
      tx.insert(findings).values({
        id,
        scanId: input.scanId,
        detector: input.detector,
        severity: input.severity,
        confidence: input.confidence,
        exploitability: input.exploitability ?? 0,
        title: input.title,
        description: input.description ?? '',
        locationPath: input.locationPath,
        locationLineStart: input.locationLineStart,
        locationLineEnd: input.locationLineEnd ?? null,
        locationCommit: input.locationCommit ?? null,
        dataFlow: input.dataFlow != null ? JSON.stringify(input.dataFlow) : null,
        evidenceHistory: input.evidenceHistory != null ? JSON.stringify(input.evidenceHistory) : null,
        patchDiff: input.patchDiff ?? null,
        patchExplanation: input.patchExplanation ?? null,
        patchContext: input.patchContext ?? null,
        patchGeneratedAt: input.patchGeneratedAt ?? null,
        validationModel: input.validationModel ?? null,
        validationPasses: input.validationPasses ?? null,
        validationRationale: input.validationRationale ?? null,
        fpFiltered: input.fpFiltered ?? false,
        tags: input.tags != null ? JSON.stringify(input.tags) : null,
        createdAt: now,
        dedupKey,
        canonicalFindingId: canonical.id,
        firstDetectedAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
      }).run()

      // Increment canonical occurrence_count + update last_seen_at
      tx.update(findings)
        .set({
          occurrenceCount: canonical.occurrenceCount + 1,
          lastSeenAt: now,
        })
        .where(eq(findings.id, canonical.id))
        .run()
    } else {
      // Insert as canonical
      tx.insert(findings).values({
        id,
        scanId: input.scanId,
        detector: input.detector,
        severity: input.severity,
        confidence: input.confidence,
        exploitability: input.exploitability ?? 0,
        title: input.title,
        description: input.description ?? '',
        locationPath: input.locationPath,
        locationLineStart: input.locationLineStart,
        locationLineEnd: input.locationLineEnd ?? null,
        locationCommit: input.locationCommit ?? null,
        dataFlow: input.dataFlow != null ? JSON.stringify(input.dataFlow) : null,
        evidenceHistory: input.evidenceHistory != null ? JSON.stringify(input.evidenceHistory) : null,
        patchDiff: input.patchDiff ?? null,
        patchExplanation: input.patchExplanation ?? null,
        patchContext: input.patchContext ?? null,
        patchGeneratedAt: input.patchGeneratedAt ?? null,
        validationModel: input.validationModel ?? null,
        validationPasses: input.validationPasses ?? null,
        validationRationale: input.validationRationale ?? null,
        fpFiltered: input.fpFiltered ?? false,
        tags: input.tags != null ? JSON.stringify(input.tags) : null,
        createdAt: now,
        dedupKey,
        canonicalFindingId: null,
        firstDetectedAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
      }).run()
    }
  })

  const row = db.select().from(findings).where(eq(findings.id, id)).get()
  if (!row) throw new Error(`Finding ${id} not found after insert`)
  return rowToDTO(row)
}

export function getFindingById(db: DB, id: string): FindingDTO | undefined {
  const row = db.select().from(findings).where(eq(findings.id, id)).get()
  if (!row) return undefined
  return rowToDTO(row)
}

export interface ListFindingsOpts {
  cursor?: string
  limit?: number
  severity?: string
  fpFiltered?: boolean
}

export function listFindings(
  db: DB,
  scanId: string,
  opts: ListFindingsOpts = {},
): ListFindingsResult {
  const limit = opts.limit ?? 50

  let cursor: { id: string; createdAt: string } | null = null
  if (opts.cursor) {
    cursor = decodeCursor(opts.cursor)
  }

  // Build WHERE conditions
  const conditions = [eq(findings.scanId, scanId)]
  if (opts.severity !== undefined) {
    conditions.push(eq(findings.severity, opts.severity))
  }
  if (opts.fpFiltered !== undefined) {
    conditions.push(eq(findings.fpFiltered, opts.fpFiltered))
  }

  // Build page condition
  let pageCondition = and(...conditions)
  if (cursor) {
    pageCondition = and(
      ...conditions,
      or(
        lt(findings.createdAt, cursor.createdAt),
        and(
          eq(findings.createdAt, cursor.createdAt),
          lt(findings.id, cursor.id),
        ),
      ),
    )
  }

  const rows = db
    .select()
    .from(findings)
    .where(pageCondition)
    .orderBy(findings.createdAt, findings.id)
    .limit(limit + 1)
    .all()

  const hasMore = rows.length > limit

  // Remove the extra item used for detection
  const items = hasMore ? rows.slice(0, limit) : rows

  const findingsList = items.map(rowToDTO)

  let nextCursor: string | null = null
  if (hasMore) {
    const last = findingsList[findingsList.length - 1]
    nextCursor = encodeCursor(last.id, last.createdAt)
  }

  return { findings: findingsList, nextCursor }
}

export function countFindings(
  db: DB,
  scanId: string,
  opts: Pick<ListFindingsOpts, 'severity' | 'fpFiltered'> = {},
): number {
  const conditions = [eq(findings.scanId, scanId)]
  if (opts.severity !== undefined) {
    conditions.push(eq(findings.severity, opts.severity))
  }
  if (opts.fpFiltered !== undefined) {
    conditions.push(eq(findings.fpFiltered, opts.fpFiltered))
  }
  const rows = db
    .select({ id: findings.id })
    .from(findings)
    .where(and(...conditions))
    .all()
  return rows.length
}

export function updateFinding(
  db: DB,
  id: string,
  input: UpdateFindingInput,
): FindingDTO {
  const updateData: Record<string, unknown> = {}

  if (input.severity !== undefined) updateData.severity = input.severity
  if (input.confidence !== undefined) updateData.confidence = input.confidence
  if (input.exploitability !== undefined) updateData.exploitability = input.exploitability
  if (input.title !== undefined) updateData.title = input.title
  if (input.description !== undefined) updateData.description = input.description
  if (input.patchDiff !== undefined) updateData.patchDiff = input.patchDiff
  if (input.patchExplanation !== undefined) updateData.patchExplanation = input.patchExplanation
  if (input.patchContext !== undefined) updateData.patchContext = input.patchContext
  if (input.patchGeneratedAt !== undefined) updateData.patchGeneratedAt = input.patchGeneratedAt
  if (input.validationModel !== undefined) updateData.validationModel = input.validationModel
  if (input.validationPasses !== undefined) updateData.validationPasses = input.validationPasses
  if (input.validationRationale !== undefined) updateData.validationRationale = input.validationRationale
  if (input.fpFiltered !== undefined) updateData.fpFiltered = input.fpFiltered
  if (input.tags !== undefined) updateData.tags = input.tags != null ? JSON.stringify(input.tags) : null
  // v0.4 fields
  if (input.status !== undefined) {
    findingStatusSchema.parse(input.status) // validate before writing (ADR-8)
    updateData.status = input.status
  }
  if (input.proofOfFixId !== undefined) updateData.proofOfFixId = input.proofOfFixId
  if (input.isRegression !== undefined) updateData.isRegression = input.isRegression ? 1 : 0
  if (input.regressionOfFindingId !== undefined) updateData.regressionOfFindingId = input.regressionOfFindingId

  if (Object.keys(updateData).length > 0) {
    db.update(findings).set(updateData).where(eq(findings.id, id)).run()
  }

  const row = db.select().from(findings).where(eq(findings.id, id)).get()
  if (!row) throw new Error(`Finding ${id} not found after update`)
  return rowToDTO(row)
}

export function deleteFinding(db: DB, id: string): void {
  db.delete(findings).where(eq(findings.id, id)).run()
}

/**
 * Updates only the status field of a finding, validating via findingStatusSchema (ADR-8).
 * Throws a Zod validation error if the status value is not in the allowed enum.
 *
 * @param db - Drizzle database instance
 * @param id - The finding ID to update
 * @param status - The new status value (must be a valid FindingStatus)
 * @returns The updated FindingDTO
 */
export function updateFindingStatus(db: DB, id: string, status: FindingStatus): FindingDTO {
  // Validate before write — ADR-8: no DB-level CHECK, enforced in repo layer
  findingStatusSchema.parse(status)

  db.update(findings).set({ status }).where(eq(findings.id, id)).run()

  const row = db.select().from(findings).where(eq(findings.id, id)).get()
  if (!row) throw new Error(`Finding ${id} not found after status update`)
  return rowToDTO(row)
}
