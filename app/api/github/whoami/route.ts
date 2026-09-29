/**
 * GET /api/github/whoami
 *
 * Proxy to GET https://api.github.com/user — verifies the configured
 * GitHub token is valid. Returns the authenticated user's login name.
 *
 * This keeps the GitHub token server-side; the client never sees it.
 */
import { ok } from '@/lib/api/envelope'
import { fail } from '@/lib/api/errors'
import { githubFetch } from '@/lib/integrations/github/client'

/** Test the configured GitHub token by fetching the authenticated user. */
export async function GET(): Promise<Response> {
  try {
    const res = await githubFetch('/user') // github-api-fetch
    if (!res.ok) {
      return fail('INTERNAL', `GitHub API returned ${res.status}`)
    }
    const user = (await res.json()) as { login: string; name?: string }
    return ok({ login: user.login, name: user.name ?? null })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return fail('INTERNAL', message)
  }
}
