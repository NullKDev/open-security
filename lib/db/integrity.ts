/**
 * lib/db/integrity.ts — Startup integrity checker for v0.4 domain data
 *
 * Validates that enum-constrained columns in the SQLite database
 * contain only expected values. Called at boot time for logging only —
 * never throws, never aborts the process.
 *
 * Design: ADR-8 (v0.4 design.md) — status enum enforcement via Zod at write
 * time + this integrity check at read time for belt-and-suspenders.
 */
import { notInArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { findings, fixProofs } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

type DB = BetterSQLite3Database<typeof schema>

/** Allowed values for findings.status (v0.4 domain) */
const VALID_FINDING_STATUSES = [
  'open',
  'fixed',
  'dismissed',
  'verified-fixed',
  'fix-unverified',
  'regression',
] as const

/** Allowed values for fix_proofs.outcome */
const VALID_PROOF_OUTCOMES = [
  'in-progress',
  'verified-fixed',
  'fix-unverified',
] as const

export interface IntegrityReport {
  ok: boolean
  issues: string[]
}

/**
 * Checks the integrity of enum-constrained columns in the database.
 *
 * Queries findings.status and fix_proofs.outcome for any values outside
 * the expected sets. Returns a report without throwing — designed for
 * logging at startup, not for crash-gating.
 *
 * @param db - Drizzle database instance
 * @returns IntegrityReport with ok=true and empty issues when clean
 */
export function checkIntegrity(db: DB): IntegrityReport {
  const issues: string[] = []

  try {
    // Check findings.status for invalid values
    // Grouped by status: returns rows with { status, cnt } (cnt = count of rows with that status)
    const invalidFindingStatuses = db
      .select({ status: findings.status, cnt: findings.id })
      .from(findings)
      .where(notInArray(findings.status, [...VALID_FINDING_STATUSES]))
      .all() as Array<{ status: string; cnt: number | string }>

    // Aggregate by status: sum cnt values (handles both pre-grouped and raw rows)
    const statusCounts = new Map<string, number>()
    for (const row of invalidFindingStatuses) {
      const n = typeof row.cnt === 'number' ? row.cnt : 1
      statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + n)
    }

    for (const [status, count] of statusCounts) {
      issues.push(`findings.status: ${count} rows with invalid value "${status}"`)
    }

    // Check fix_proofs.outcome for invalid values
    const invalidProofOutcomes = db
      .select({ outcome: fixProofs.outcome, cnt: fixProofs.id })
      .from(fixProofs)
      .where(notInArray(fixProofs.outcome, [...VALID_PROOF_OUTCOMES]))
      .all() as Array<{ outcome: string; cnt: number | string }>

    const outcomeCounts = new Map<string, number>()
    for (const row of invalidProofOutcomes) {
      const n = typeof row.cnt === 'number' ? row.cnt : 1
      outcomeCounts.set(row.outcome, (outcomeCounts.get(row.outcome) ?? 0) + n)
    }

    for (const [outcome, count] of outcomeCounts) {
      issues.push(`fix_proofs.outcome: ${count} rows with invalid value "${outcome}"`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    issues.push(`integrity check failed: ${message}`)
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}
