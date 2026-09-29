import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { getScanById, updateScanStatus, listScanChildren } from '@/lib/repos/scans.repo'
import { getRunningScans } from '../route'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()
  const scan = getScanById(db, id)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${id} not found`)
  }
  const children = listScanChildren(db, id)
  return ok({ ...scan, children })
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params
  const db = getDb()
  const scan = getScanById(db, id)
  if (!scan) {
    return fail('NOT_FOUND', `Scan ${id} not found`)
  }

  // Send SIGTERM to running worker if present
  const runningScans = getRunningScans()
  const abort = runningScans.get(id)
  if (abort) {
    abort()
    runningScans.delete(id)
  }

  // Mark as cancelled in DB
  const updated = updateScanStatus(db, id, 'cancelled')
  return ok({ id: updated.id, status: updated.status })
}
