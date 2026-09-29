/**
 * tests/unit/diff/github-pr.test.ts
 *
 * TDD: T-D03 — GitHub PR file fetch
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch so we don't make real API calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { getPrChangedFiles } = await import('@/lib/diff/github-pr')

describe('getPrChangedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('exports getPrChangedFiles as a function', () => {
    expect(typeof getPrChangedFiles).toBe('function')
  })

  it('returns list of changed file paths for a PR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [
        { filename: 'src/auth/login.ts', status: 'modified' },
        { filename: 'src/components/Button.tsx', status: 'added' },
      ],
    })

    const files = await getPrChangedFiles({
      owner: 'myorg',
      repo: 'myrepo',
      prNumber: 42,
      token: 'ghp_test_token',
    })

    expect(files).toEqual(['src/auth/login.ts', 'src/components/Button.tsx'])
  })

  it('handles pagination (multiple pages)', async () => {
    // First page returns 1 file, has Link header pointing to next
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h === 'Link'
              ? '<https://api.github.com/repos/org/repo/pulls/1/files?page=2>; rel="next"'
              : null,
        },
        json: async () => [{ filename: 'src/a.ts', status: 'modified' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [{ filename: 'src/b.ts', status: 'added' }],
      })

    const files = await getPrChangedFiles({
      owner: 'org',
      repo: 'repo',
      prNumber: 1,
      token: 'ghp_test',
    })

    expect(files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('stops pagination at 3000 files cap', async () => {
    // Generate 3000 files across 30 pages (100 per page)
    let pageCount = 0
    mockFetch.mockImplementation(async () => {
      pageCount++
      const files = Array.from({ length: 100 }, (_, i) => ({
        filename: `src/file-${pageCount}-${i}.ts`,
        status: 'modified',
      }))
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h === 'Link' && pageCount < 35
              ? `<https://api.github.com/repos/o/r/pulls/1/files?page=${pageCount + 1}>; rel="next"`
              : null,
        },
        json: async () => files,
      }
    })

    const files = await getPrChangedFiles({
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      token: 'ghp_test',
    })

    expect(files.length).toBeLessThanOrEqual(3000)
  })

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ message: 'Forbidden' }),
    })

    await expect(
      getPrChangedFiles({ owner: 'o', repo: 'r', prNumber: 1, token: 'ghp_bad' }),
    ).rejects.toThrow(/403/)
  })

  it('includes Authorization header with token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [],
    })

    await getPrChangedFiles({ owner: 'o', repo: 'r', prNumber: 1, token: 'ghp_mytoken' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/pulls/1/files'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_mytoken',
        }),
      }),
    )
  })
})
