/**
 * @file lib/repos/fix-proofs.repo.ts
 *
 * Repository for fix_proofs — the Fix & Prove triad attempt records.
 * One row per triad run; findings.proof_of_fix_id points to the latest row.
 *
 * Design: ADR-3 (v0.4 design.md)
 */
import { eq, and, desc, lt, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { fixProofs } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface FixProofDTO {
  id: string
  findingId: string
  branchId: string | null
  patchDiff: string
  regressionTestPath: string | null
  regressionTestDiff: string | null
  unitTestPassed: boolean | null
  vulRunPassedPre: boolean | null
  vulRunPassedPost: boolean | null
  outcome: string
  failureReason: string | null
  prePatchOutput: string | null
  postPatchOutput: string | null
  unitTestOutput: string | null
  startedAt: string
  completedAt: string | null
  acpSessionId: string | null
}

export interface CreateProofInput {
  findingId: string
  patchDiff: string
  branchId?: string
  acpSessionId?: string
  /** Optional override for startedAt (useful for testing stale-sweep). Defaults to now. */
  startedAt?: string
}

export interface MarkOutcomeInput {
  outcome: string
  failureReason?: string
  unitTestPassed?: boolean
  vulRunPassedPre?: boolean
  vulRunPassedPost?: boolean
  regressionTestPath?: string
  regressionTestDiff?: string
  prePatchOutput?: string
  postPatchOutput?: string
  unitTestOutput?: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID()
}

function rowToDTO(row: typeof fixProofs.$inferSelect): FixProofDTO {
  return {
    id: row.id,
    findingId: row.findingId,
    branchId: row.branchId ?? null,
    patchDiff: row.patchDiff,
    regressionTestPath: row.regressionTestPath ?? null,
    regressionTestDiff: row.regressionTestDiff ?? null,
    unitTestPassed: row.unitTestPassed ?? null,
    vulRunPassedPre: row.vulRunPassedPre ?? null,
    vulRunPassedPost: row.vulRunPassedPost ?? null,
    outcome: row.outcome,
    failureReason: row.failureReason ?? null,
    prePatchOutput: row.prePatchOutput ?? null,
    postPatchOutput: row.postPatchOutput ?? null,
    unitTestOutput: row.unitTestOutput ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    acpSessionId: row.acpSessionId ?? null,
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new fix proof row with outcome='in-progress'.
 * Call this immediately before starting a triad run.
 *
 * @param db - Drizzle database instance
 * @param input - Proof creation input
 * @returns The created FixProofDTO
 */
export function createProof(db: DB, input: CreateProofInput): FixProofDTO {
  const id = uuid()
  const now = input.startedAt ?? new Date().toISOString()

  db.insert(fixProofs)
    .values({
      id,
      findingId: input.findingId,
      branchId: input.branchId ?? null,
      patchDiff: input.patchDiff,
      outcome: 'in-progress',
      startedAt: now,
      acpSessionId: input.acpSessionId ?? null,
    })
    .run()

  const row = db.select().from(fixProofs).where(eq(fixProofs.id, id)).get()
  if (!row) throw new Error(`fix_proofs row ${id} not found after insert`)
  return rowToDTO(row)
}

/**
 * Returns the most recently started proof for a given finding.
 * Returns null if no proof exists.
 *
 * @param db - Drizzle database instance
 * @param findingId - The finding ID to look up
 * @returns The latest FixProofDTO or null
 */
export function getLatestProof(db: DB, findingId: string): FixProofDTO | null {
  const row = db
    .select()
    .from(fixProofs)
    .where(eq(fixProofs.findingId, findingId))
    .orderBy(desc(fixProofs.startedAt))
    .limit(1)
    .get()

  return row ? rowToDTO(row) : null
}

/**
 * Updates the outcome fields of a proof row and sets completedAt to now.
 * Used to finalize a triad run with its verdict and captured outputs.
 *
 * @param db - Drizzle database instance
 * @param proofId - The proof row ID to update
 * @param input - Outcome data
 * @returns The updated FixProofDTO
 */
export function markOutcome(db: DB, proofId: string, input: MarkOutcomeInput): FixProofDTO {
  const now = new Date().toISOString()

  db.update(fixProofs)
    .set({
      outcome: input.outcome,
      failureReason: input.failureReason ?? null,
      unitTestPassed: input.unitTestPassed ?? null,
      vulRunPassedPre: input.vulRunPassedPre ?? null,
      vulRunPassedPost: input.vulRunPassedPost ?? null,
      regressionTestPath: input.regressionTestPath ?? null,
      regressionTestDiff: input.regressionTestDiff ?? null,
      prePatchOutput: input.prePatchOutput ?? null,
      postPatchOutput: input.postPatchOutput ?? null,
      unitTestOutput: input.unitTestOutput ?? null,
      completedAt: now,
    })
    .where(eq(fixProofs.id, proofId))
    .run()

  const row = db.select().from(fixProofs).where(eq(fixProofs.id, proofId)).get()
  if (!row) throw new Error(`fix_proofs row ${proofId} not found after update`)
  return rowToDTO(row)
}

/**
 * Sweeps proof rows whose outcome is still 'in-progress' and whose startedAt
 * is older than `olderThanSeconds` seconds. Marks them as 'fix-unverified'
 * with failureReason='agent-error'.
 *
 * Intended to be called at boot time to clean up orphaned proofs from a crash.
 *
 * @param db - Drizzle database instance
 * @param olderThanSeconds - Age threshold in seconds (e.g. 3600 = 1 hour)
 * @returns Number of rows swept
 */
export function sweepStaleInProgress(db: DB, olderThanSeconds: number): number {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString()
  const now = new Date().toISOString()

  // Find stale rows first so we know the count
  const stale = db
    .select({ id: fixProofs.id })
    .from(fixProofs)
    .where(
      and(
        eq(fixProofs.outcome, 'in-progress'),
        lt(fixProofs.startedAt, cutoff),
      ),
    )
    .all()

  if (stale.length === 0) return 0

  db.update(fixProofs)
    .set({
      outcome: 'fix-unverified',
      failureReason: 'agent-error',
      completedAt: now,
    })
    .where(
      and(
        eq(fixProofs.outcome, 'in-progress'),
        lt(fixProofs.startedAt, cutoff),
      ),
    )
    .run()

  return stale.length
}
