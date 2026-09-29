/**
 * Pure utilities for branch status display logic.
 * Extracted from the component so they can be unit-tested without rendering.
 */

export type BranchStatus =
  | 'pending'
  | 'creating'
  | 'created'
  | 'apply_failed'
  | 'tests_running'
  | 'tests_failed'

const TERMINAL_STATUSES: Set<string> = new Set([
  'created',
  'apply_failed',
  'tests_failed',
])

/**
 * Returns true when the branch status is in a terminal state and polling
 * should stop.
 */
export function isTerminalBranchStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  creating: 'Creating branch…',
  tests_running: 'Running tests…',
  created: 'Branch created',
  apply_failed: 'Apply failed',
  tests_failed: 'Tests failed',
}

/**
 * Returns a human-readable label for a branch status value.
 */
export function branchStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-gray-500',
  creating: 'text-blue-600',
  tests_running: 'text-blue-600',
  created: 'text-green-600',
  apply_failed: 'text-red-600',
  tests_failed: 'text-red-600',
}

/**
 * Returns a Tailwind text color class for a branch status value.
 */
export function branchStatusColor(status: string): string {
  return STATUS_COLOR[status] ?? 'text-gray-500'
}
