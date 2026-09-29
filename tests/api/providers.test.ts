/**
 * tests/api/providers.test.ts
 * Tests for GET /api/providers — list available providers
 */
import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/providers/route'

describe('GET /api/providers', () => {
  it('returns cli and api provider lists', async () => {
    const req = new Request('http://localhost/api/providers')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.cli).toBeDefined()
    expect(body.data.api).toBeDefined()
    expect(Array.isArray(body.data.cli)).toBe(true)
    expect(Array.isArray(body.data.api)).toBe(true)
  })

  it('returns 9 CLI agent definitions', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body.data.cli.length).toBe(9)
  })

  it('returns 4 API provider entries', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body.data.api.length).toBe(4)
  })

  it('each CLI entry has expected shape', async () => {
    const res = await GET()
    const body = await res.json()

    const claude = body.data.cli.find((p: { id: string }) => p.id === 'claude')
    expect(claude).toBeDefined()
    expect(claude.type).toBe('cli')
    expect(claude.bin).toBe('claude')
    expect(typeof claude.available).toBe('boolean')
    expect(claude.streamFormat).toBeDefined()
  })
})
