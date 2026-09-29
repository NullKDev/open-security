/**
 * tests/unit/integrations/github/client.test.ts
 *
 * TDD: T-E01 — GitHub REST client
 * Tests: successful requests, auth header, retry on 403 secondary rate limit,
 *        abort on non-retryable errors, exhausted retries throw.
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock readConfig ──────────────────────────────────────────────────────────
vi.mock('@/lib/config/store', () => ({
  readConfig: vi.fn(() => ({
    models: {},
    providers: { githubToken: 'ghp_test_token_123' },
    theme: 'dark',
    workerMemoryMb: 2048,
    stage2Concurrency: 4,
  })),
}))

// ─── We test githubFetch by capturing what fetch was called with ──────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { githubFetch } from '@/lib/integrations/github/client'

function makeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('githubFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('makes a GET request to the GitHub API with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { login: 'octocat' }))

    const res = await githubFetch('/user')

    expect(res.status).toBe(200)
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toBe('https://api.github.com/user')
    expect(call[1].headers['Authorization']).toBe('Bearer ghp_test_token_123')
  })

  it('includes Accept header for GitHub REST API', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200))

    await githubFetch('/repos/owner/repo')

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers['Accept']).toBe('application/vnd.github+json')
  })

  it('passes through custom RequestInit options', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(201))

    const body = JSON.stringify({ body: 'comment text' })
    await githubFetch('/repos/owner/repo/issues/1/comments', {
      method: 'POST',
      body,
    })

    const call = mockFetch.mock.calls[0]
    expect(call[1].method).toBe('POST')
    expect(call[1].body).toBe(body)
  })

  it('retries up to 3 times on 403 secondary rate limit and eventually succeeds', async () => {
    vi.useFakeTimers()

    // Two 403s then success
    mockFetch
      .mockResolvedValueOnce(makeResponse(403, { message: 'rate limit' }))
      .mockResolvedValueOnce(makeResponse(403, { message: 'rate limit' }))
      .mockResolvedValueOnce(makeResponse(200, { login: 'octocat' }))

    const promise = githubFetch('/user')

    // Advance through the exponential backoff delays (2^1 * 1000ms + 2^2 * 1000ms = 6s total)
    await vi.runAllTimersAsync()
    const res = await promise

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting all 3 retries on persistent 403', async () => {
    vi.useFakeTimers()

    mockFetch
      .mockResolvedValueOnce(makeResponse(403))
      .mockResolvedValueOnce(makeResponse(403))
      .mockResolvedValueOnce(makeResponse(403))

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const promise = githubFetch('/user').catch((err) => { throw err })
    await vi.runAllTimersAsync()

    await expect(promise).rejects.toThrow(/rate limit|403/i)
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry on 404 — returns immediately', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(404, { message: 'Not Found' }))

    const res = await githubFetch('/repos/owner/missing')

    expect(res.status).toBe(404)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 422 — returns immediately', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(422))

    const res = await githubFetch('/repos/owner/repo/contents/file')

    expect(res.status).toBe(422)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('works without a GitHub token (no Authorization header)', async () => {
    const { readConfig } = await import('@/lib/config/store')
    vi.mocked(readConfig).mockReturnValueOnce({
      models: {},
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    })

    mockFetch.mockResolvedValueOnce(makeResponse(200))

    await githubFetch('/user')

    const call = mockFetch.mock.calls[0]
    expect(call[1].headers['Authorization']).toBeUndefined()
  })
})
