/**
 * PUT /api/integrations/[target]
 *
 * Save integration credentials for the given target.
 * Sensitive fields (apiToken, pat, apiKey, webhookUrl) are encrypted
 * via secret-store. Non-sensitive metadata is stored in the config table.
 *
 * Supported targets: jira, slack, github-code-scanning, socket
 *
 * Response: { ok: true }
 * Errors: 400 (invalid target or body), 500 (save error)
 */
import { z } from 'zod'
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { getDb } from '@/lib/db/client'
import { createSecretStore } from '@/lib/security/secret-store'
import { deriveMachineKey } from '@/lib/security/machine-key'
import type Database from 'better-sqlite3'

interface RouteContext {
  params: Promise<{ target: string }>
}

// ─── Per-target Zod schemas ────────────────────────────────────────────────

const JiraSchema = z.object({
  baseUrl: z.string().url(),
  projectKey: z.string().min(1),
  email: z.string().email(),
  apiToken: z.string().min(1),
})

const SlackSchema = z.object({
  webhookUrl: z.string().url(),
})

const GithubCodeScanningSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pat: z.string().min(1),
})

const SocketSchema = z.object({
  apiKey: z.string().min(1),
})

type Target = 'jira' | 'slack' | 'github-code-scanning' | 'socket'

const VALID_TARGETS = new Set<string>(['jira', 'slack', 'github-code-scanning', 'socket'])

/**
 * Extract the raw better-sqlite3 Database instance from a Drizzle wrapper.
 * Drizzle for better-sqlite3 exposes the underlying DB via `$client`.
 */
function getRawDb(drizzleDb: ReturnType<typeof getDb>): Database.Database {
  return (drizzleDb as unknown as { $client: Database.Database }).$client
}

/**
 * PUT /api/integrations/[target]
 *
 * Persists integration credentials for the specified target.
 * Sensitive fields are encrypted via AES-256-GCM secret store.
 *
 * @param request - HTTP request with integration config body
 * @param context - Route context with target name
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { target } = await context.params

  if (!VALID_TARGETS.has(target)) {
    return fail('INVALID_INPUT', `Unknown integration target: ${target}`)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 'Invalid JSON body')
  }

  const db = getDb()
  const rawDb = getRawDb(db)

  try {
    const keyBytes = await deriveMachineKey()
    const secretStore = createSecretStore(rawDb, keyBytes)

    switch (target as Target) {
      case 'jira': {
        const parsed = JiraSchema.safeParse(body)
        if (!parsed.success) {
          return fail('INVALID_INPUT', parsed.error.issues.map((e) => e.message).join('; '))
        }
        await secretStore.set('integration.jira.apiToken', parsed.data.apiToken)
        break
      }

      case 'slack': {
        const parsed = SlackSchema.safeParse(body)
        if (!parsed.success) {
          return fail('INVALID_INPUT', parsed.error.issues.map((e) => e.message).join('; '))
        }
        await secretStore.set('integration.slack.webhookUrl', parsed.data.webhookUrl)
        break
      }

      case 'github-code-scanning': {
        const parsed = GithubCodeScanningSchema.safeParse(body)
        if (!parsed.success) {
          return fail('INVALID_INPUT', parsed.error.issues.map((e) => e.message).join('; '))
        }
        await secretStore.set('integration.github.pat', parsed.data.pat)
        break
      }

      case 'socket': {
        const parsed = SocketSchema.safeParse(body)
        if (!parsed.success) {
          return fail('INVALID_INPUT', parsed.error.issues.map((e) => e.message).join('; '))
        }
        await secretStore.set('integration.socket.apiKey', parsed.data.apiKey)
        break
      }
    }

    return ok({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', message)
  }
}
