/**
 * lib/integrations/github/client.ts
 *
 * Typed GitHub REST client wrapping native fetch.
 * - No Octokit dependency (saves 1MB+)
 * - Reads GitHub token from config via readConfig()
 * - Exponential backoff retry on 403 secondary rate limit (3 attempts max, 2^n * 1000ms delay)
 * - All other non-2xx responses are returned as-is (caller decides)
 */
import { readConfig } from '@/lib/config/store'

const GITHUB_API_BASE = 'https://api.github.com'
const MAX_RETRIES = 3

/**
 * Make an authenticated request to the GitHub REST API.
 *
 * Automatically adds Authorization and Accept headers.
 * Retries up to 3 times with exponential backoff on 403 secondary rate limit.
 *
 * @param path - API path relative to https://api.github.com (e.g. '/user', '/repos/owner/repo/...')
 * @param opts - Optional RequestInit to merge with default headers
 * @returns The raw Response (caller parses JSON or handles non-2xx)
 * @throws On 403 after all retries are exhausted
 */
export async function githubFetch(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const cfg = readConfig()
  const token = cfg.providers.githubToken

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...((opts.headers as Record<string, string>) ?? {}),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = `${GITHUB_API_BASE}${path}`
  const init: RequestInit = { ...opts, headers }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init) // github-api-fetch

    if (res.status !== 403) {
      return res
    }

    // 403 secondary rate limit — retry with exponential backoff
    if (attempt < MAX_RETRIES) {
      const delayMs = Math.pow(2, attempt) * 1000
      await sleep(delayMs)
    }
  }

  throw new Error(`GitHub API rate limit: 403 after ${MAX_RETRIES} attempts on ${path}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
