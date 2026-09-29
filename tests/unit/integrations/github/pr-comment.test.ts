/**
 * tests/unit/integrations/github/pr-comment.test.ts
 *
 * TDD: T-E03 — PR comment post + idempotency
 * Tests: creates comment on first call, skips if sentinel already present,
 *        updates existing comment with fresh findings, handles GitHub API errors.
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the GitHub client ───────────────────────────────────────────────────
const { mockGithubFetch } = vi.hoisted(() => ({
  mockGithubFetch: vi.fn(),
}))
vi.mock('@/lib/integrations/github/client', () => ({
  githubFetch: mockGithubFetch,
}))

import { postPrComment } from '@/lib/integrations/github/pr-comment'
import type { FindingDeltaDTO } from '@/lib/repos/scans.repo'

function makeFindings(count: number): FindingDeltaDTO[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `finding-${i}`,
    scanId: 'scan-001',
    detector: 'semgrep',
    severity: 'high',
    confidence: 0.9,
    title: `Finding ${i}`,
    locationPath: `src/file${i}.ts`,
    locationLineStart: 10 + i,
    dedupKey: `dedup-${i}`,
  }))
}

function makeCommentsResponse(comments: Array<{ id: number; body: string }>): Response {
  return new Response(JSON.stringify(comments), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeCreatedResponse(id: number): Response {
  return new Response(JSON.stringify({ id, html_url: `https://github.com/owner/repo/issues/1#issuecomment-${id}` }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  })
}

function makeOkResponse(): Response {
  return new Response('{}', { status: 200 })
}

describe('postPrComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new comment when no existing open-security comment exists', async () => {
    // GET /repos/.../issues/1/comments → empty list
    mockGithubFetch
      .mockResolvedValueOnce(makeCommentsResponse([]))
      .mockResolvedValueOnce(makeCreatedResponse(12345))

    await postPrComment('owner', 'repo', 1, makeFindings(2), 'scan-001')

    expect(mockGithubFetch).toHaveBeenCalledTimes(2)

    // First call: list existing comments
    const listCall = mockGithubFetch.mock.calls[0]
    expect(listCall[0]).toContain('/repos/owner/repo/issues/1/comments')

    // Second call: create comment
    const createCall = mockGithubFetch.mock.calls[1]
    expect(createCall[1].method).toBe('POST')
    const body = JSON.parse(createCall[1].body as string)
    expect(body.body).toContain('<!-- obt:scan:scan-001 -->')
    expect(body.body).toContain('Finding 0')
  })

  it('skips creating a new comment when the sentinel already exists (same scanId)', async () => {
    const existingBody = '<!-- obt:scan:scan-001 -->\n## open-security findings'
    mockGithubFetch.mockResolvedValueOnce(
      makeCommentsResponse([{ id: 99, body: existingBody }])
    )

    await postPrComment('owner', 'repo', 1, makeFindings(1), 'scan-001')

    // Only 1 call: the list. No create call.
    expect(mockGithubFetch).toHaveBeenCalledTimes(1)
  })

  it('updates existing comment when sentinel exists for a different scanId', async () => {
    const existingBody = '<!-- obt:scan:scan-OLD -->\n## old findings'
    mockGithubFetch
      .mockResolvedValueOnce(makeCommentsResponse([{ id: 99, body: existingBody }]))
      .mockResolvedValueOnce(makeOkResponse())

    await postPrComment('owner', 'repo', 1, makeFindings(1), 'scan-002')

    expect(mockGithubFetch).toHaveBeenCalledTimes(2)

    const updateCall = mockGithubFetch.mock.calls[1]
    expect(updateCall[0]).toContain('/repos/owner/repo/issues/comments/99')
    expect(updateCall[1].method).toBe('PATCH')
    const body = JSON.parse(updateCall[1].body as string)
    expect(body.body).toContain('<!-- obt:scan:scan-002 -->')
  })

  it('collapses findings list in details block when more than 10 findings', async () => {
    mockGithubFetch
      .mockResolvedValueOnce(makeCommentsResponse([]))
      .mockResolvedValueOnce(makeCreatedResponse(99))

    await postPrComment('owner', 'repo', 1, makeFindings(15), 'scan-001')

    const createCall = mockGithubFetch.mock.calls[1]
    const body = JSON.parse(createCall[1].body as string)
    expect(body.body).toContain('<details>')
    expect(body.body).toContain('<summary>')
  })

  it('throws when GitHub API returns non-2xx on create', async () => {
    mockGithubFetch
      .mockResolvedValueOnce(makeCommentsResponse([]))
      .mockResolvedValueOnce(new Response('{"message":"Forbidden"}', { status: 403 }))

    await expect(
      postPrComment('owner', 'repo', 1, makeFindings(1), 'scan-001')
    ).rejects.toThrow(/403|Forbidden/i)
  })

  it('formats findings with severity and location', async () => {
    mockGithubFetch
      .mockResolvedValueOnce(makeCommentsResponse([]))
      .mockResolvedValueOnce(makeCreatedResponse(1))

    const findings: FindingDeltaDTO[] = [{
      id: 'f1',
      scanId: 'scan-001',
      detector: 'gitleaks',
      severity: 'critical',
      confidence: 0.95,
      title: 'Secret in code',
      locationPath: 'src/auth.ts',
      locationLineStart: 42,
      dedupKey: 'dk-1',
    }]

    await postPrComment('owner', 'repo', 1, findings, 'scan-001')

    const createCall = mockGithubFetch.mock.calls[1]
    const body = JSON.parse(createCall[1].body as string)
    expect(body.body).toContain('Secret in code')
    expect(body.body).toContain('src/auth.ts')
    expect(body.body).toMatch(/critical/i)
  })
})
