/**
 * branch-service.ts — Branch creation state machine
 *
 * Orchestrates the full fix-branch lifecycle for a finding:
 * pending → creating → apply_failed | tests_running → tests_failed | created
 *
 * Design constraints (Design §5):
 * - targetPath = scanSourceDir(scan.projectId, scan.id) via workspace.ts
 * - scanCommit = finding.locationCommit or git rev-parse HEAD
 * - All git ops via git-ops.ts (spawn in argv form, no shell)
 * - test_command runs via test-runner.ts (shell: true by user choice)
 * - Never throws: all errors caught, status set to apply_failed
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { findings, scans, projects, findingBranches } from '@/lib/db/schema'
import {
  updateBranchStatus,
} from '@/lib/repos/finding-branches.repo'
import { buildBranchName, resolveHeadCommit, checkoutBranch, applyPatch } from './git-ops'
import { runTestCommand } from './test-runner'
import { scanSourceDir } from '@/lib/config/workspace'

type DB = BetterSQLite3Database<typeof schema>

interface FindingRow {
  id: string
  scanId: string
  patchDiff: string | null
  locationCommit: string | null
}

interface ScanRow {
  id: string
  projectId: string
}

interface ProjectRow {
  id: string
  testCommand: string | null
  testsEnabled: number
}

function loadFinding(db: DB, branchId: string): { finding: FindingRow; scan: ScanRow; project: ProjectRow } | null {
  // Get the branch record to find findingId
  const branchRow = db.select().from(findingBranches).where(eq(findingBranches.id, branchId)).get()
  if (!branchRow) return null

  const findingRow = db
    .select({
      id: findings.id,
      scanId: findings.scanId,
      patchDiff: findings.patchDiff,
      locationCommit: findings.locationCommit,
    })
    .from(findings)
    .where(eq(findings.id, branchRow.findingId))
    .get()

  if (!findingRow) return null

  const scanRow = db
    .select({ id: scans.id, projectId: scans.projectId })
    .from(scans)
    .where(eq(scans.id, findingRow.scanId))
    .get()

  if (!scanRow) return null

  const projectRow = db
    .select({
      id: projects.id,
      testCommand: projects.testCommand,
      testsEnabled: projects.testsEnabled,
    })
    .from(projects)
    .where(eq(projects.id, scanRow.projectId))
    .get()

  if (!projectRow) return null

  return {
    finding: findingRow,
    scan: scanRow,
    project: projectRow,
  }
}

/**
 * Executes the full branch creation workflow for a given branch record.
 *
 * Steps:
 * 1. Load finding, scan, project from DB
 * 2. Validate that patchDiff is present
 * 3. Resolve scanCommit (locationCommit or HEAD)
 * 4. Set status to 'creating'
 * 5. Create branch: `git checkout -b sec/fix/<id> <commit>`
 * 6. Apply patch: `git apply --check && git apply`
 * 7. If testsEnabled: run test command, set tests_running → tests_failed | created
 * 8. If not testsEnabled: set status to 'created'
 *
 * On any error, sets status to 'apply_failed' with the error message.
 * Never throws.
 *
 * @param db - Drizzle database instance
 * @param branchId - The branch record ID (from finding_branches.id)
 * @param cacheDir - OBT cache directory (used for workspace path resolution)
 */
export async function createFixBranch(
  db: DB,
  branchId: string,
  _cacheDir: string,
): Promise<void> {
  const context = loadFinding(db, branchId)

  if (!context) {
    console.warn(`[remediation] Branch ${branchId}: finding or scan not found`)
    return
  }

  const { finding, scan, project } = context

  // Validate patch exists
  if (!finding.patchDiff) {
    updateBranchStatus(db, branchId, 'apply_failed', {
      applyError: 'no patch_diff available for this finding',
    })
    return
  }

  // Resolve target path and scan commit
  const targetPath = scanSourceDir(scan.projectId, scan.id)

  let scanCommit = finding.locationCommit
  if (!scanCommit) {
    scanCommit = await resolveHeadCommit(targetPath)
    if (!scanCommit) {
      updateBranchStatus(db, branchId, 'apply_failed', {
        applyError: 'could not resolve HEAD commit in target path',
      })
      return
    }
  }

  const branchRef = buildBranchName(finding.id)

  // Transition to creating
  updateBranchStatus(db, branchId, 'creating', { branchRef })

  // Step 1: Create branch
  const checkoutResult = await checkoutBranch(targetPath, branchRef, scanCommit)
  if (!checkoutResult.ok) {
    updateBranchStatus(db, branchId, 'apply_failed', {
      applyError: checkoutResult.error ?? 'git checkout failed',
    })
    return
  }

  // Step 2: Apply patch
  const patchResult = await applyPatch(targetPath, finding.patchDiff)
  if (!patchResult.ok) {
    updateBranchStatus(db, branchId, 'apply_failed', {
      applyError: patchResult.error ?? 'git apply failed',
    })
    return
  }

  // Step 3: Run tests if enabled
  if (project.testsEnabled === 1 && project.testCommand) {
    updateBranchStatus(db, branchId, 'tests_running')

    const testResult = await runTestCommand(targetPath, project.testCommand)

    if (testResult.passed) {
      updateBranchStatus(db, branchId, 'created', {
        testsPassed: 1,
        testsOutput: testResult.output,
      })
    } else {
      updateBranchStatus(db, branchId, 'tests_failed', {
        testsPassed: 0,
        testsOutput: testResult.output,
      })
    }
  } else {
    // No tests configured — branch is ready
    updateBranchStatus(db, branchId, 'created')
  }
}
