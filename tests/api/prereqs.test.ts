/**
 * tests/api/prereqs.test.ts
 * Tests for GET /api/prereqs — prerequisite check
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the checker so tests don't actually exec binaries
vi.mock('@/lib/config/prereqs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/config/prereqs')>()
  return {
    ...mod,
    checkPrereqs: vi.fn(() => [
      { name: 'git', present: true, version: '2.39.0' },
      { name: 'gitleaks', present: true, version: '8.18.0' },
      { name: 'semgrep', present: false },
      { name: 'trufflehog', present: true, version: '3.67.0' },
      { name: 'osv-scanner', present: false },
    ]),
  }
})

import { GET } from '@/app/api/prereqs/route'

describe('GET /api/prereqs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with prereq list', async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.prereqs)).toBe(true)
    expect(body.data.prereqs.length).toBe(5)
  })

  it('correctly reports missing prereqs', async () => {
    const res = await GET()
    const body = await res.json()

    const semgrep = body.data.prereqs.find((p: { name: string }) => p.name === 'semgrep')
    expect(semgrep.present).toBe(false)

    const osvScanner = body.data.prereqs.find((p: { name: string }) => p.name === 'osv-scanner')
    expect(osvScanner.present).toBe(false)

    // allPresent should be false since 2 are missing
    expect(body.data.allPresent).toBe(false)
  })

  it('includes version for present tools', async () => {
    const res = await GET()
    const body = await res.json()

    const git = body.data.prereqs.find((p: { name: string }) => p.name === 'git')
    expect(git.version).toBeDefined()
  })
})
