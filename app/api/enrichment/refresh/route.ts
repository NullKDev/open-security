import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { getDb } from '@/lib/db/client'
import { refreshKevCatalog } from '@/lib/enrichment/kev'
import * as path from 'node:path'

/**
 * Schema for POST /api/enrichment/refresh body.
 */
const RefreshBodySchema = z.object({
  force: z.boolean().optional(),
})

/**
 * POST /api/enrichment/refresh
 *
 * Manually triggers KEV catalog refresh.
 * Best-effort — never returns an error even if the network request fails.
 *
 * Body: { force?: boolean }
 * Response: 200 { refreshed: true }
 *
 * @param request - Incoming HTTP request
 */
export async function POST(request: Request): Promise<Response> {
  // Parse body — tolerant of missing/malformed JSON
  let _parsed: z.infer<typeof RefreshBodySchema> = {}
  try {
    const body = await request.json()
    const result = RefreshBodySchema.safeParse(body)
    if (result.success) {
      _parsed = result.data
    }
  } catch {
    // Ignore parse errors — body is optional
  }

  const db = getDb()
  const cacheDir = path.join(process.env.OBT_ROOT ?? '.obt', 'cache')

  // Best-effort — never blocks, never throws to client
  try {
    await refreshKevCatalog(db, cacheDir)
  } catch (err) {
    console.warn('[enrichment] manual refresh error:', err)
  }

  return ok({ refreshed: true })
}
