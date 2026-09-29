/**
 * tests/api/sources.test.ts
 * Tests for POST /api/sources — source validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync } from 'node:child_process'

vi.mock('node:child_process', () => {
  const fn = vi.fn()
  return {
    default: { execSync: fn },
    execSync: fn,
  }
})

import { POST } from '@/app/api/sources/route'

describe('POST /api/sources', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset()
  })
  it('returns 400 when sourceType is missing', async () => {
    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({ sourceRef: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns 400 when sourceRef is missing', async () => {
    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({ sourceType: 'github' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('returns valid=true for a valid github URL', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from('refs/heads/main\nrefs/heads/dev'))

    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'github',
        sourceRef: 'https://github.com/org/repo',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(true)
  })

  it('returns noAccess=true for inaccessible repo', async () => {
    const execError = Object.assign(new Error('Command failed'), {
      stderr: Buffer.from('fatal: could not read from remote repository'),
      status: 128,
    })
    vi.mocked(execSync).mockImplementation(() => { throw execError })

    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'github',
        sourceRef: 'https://github.com/private/repo',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(false)
    expect(body.data.noAccess).toBe(true)
    expect(body.data.suggestion).toContain('local copy')
  })

  it('returns valid=false for an invalid URL', async () => {
    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'github',
        sourceRef: 'not-a-valid-url',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(false)
  })

  it('returns valid=false for non-existent local path', async () => {
    const req = new Request('http://localhost/api/sources', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'local',
        sourceRef: '/tmp/does-not-exist-12345',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.valid).toBe(false)
  })
})
