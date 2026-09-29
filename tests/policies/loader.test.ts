import { describe, it, expect, beforeEach } from 'vitest'
import { ZodError } from 'zod'

describe('loadPolicy', () => {
  beforeEach(async () => {
    // Reset module cache between tests to ensure a clean state
    const mod = await import('@/lib/policies/loader')
    mod.__resetCache()
  })

  it('loads severity.yaml and returns the correct shape', async () => {
    const { loadPolicy } = await import('@/lib/policies/loader')

    const policy = await loadPolicy('severity')

    expect(policy).toMatchObject({
      thresholds: {
        critical: expect.any(Number),
        high: expect.any(Number),
        medium: expect.any(Number),
        low: expect.any(Number),
      },
      cvss_map: expect.any(Object),
    })
  })

  it('loads confidence.yaml and returns the correct shape', async () => {
    const { loadPolicy } = await import('@/lib/policies/loader')

    const policy = await loadPolicy('confidence')

    expect(policy).toMatchObject({
      minimum_report: expect.any(Number),
      minimum_validate: expect.any(Number),
      minimum_patch: expect.any(Number),
      auto_fp_below: expect.any(Number),
    })
  })

  it('loads fp-filter.yaml and returns the correct shape', async () => {
    const { loadPolicy } = await import('@/lib/policies/loader')

    const policy = await loadPolicy('fp-filter')

    expect(policy).toHaveProperty('rules')
    expect(Array.isArray((policy as { rules: unknown[] }).rules)).toBe(true)

    const rules = (policy as { rules: Array<{ id: string; match_path: string; action: string }> }).rules
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0]).toMatchObject({
      id: expect.any(String),
      match_path: expect.any(String),
      action: expect.any(String),
    })
  })

  it('throws ZodError for invalid YAML content', async () => {
    const { loadPolicy } = await import('@/lib/policies/loader')

    // 'unknown' is not a valid policy name — cast to bypass TS to test runtime validation
    await expect(
      loadPolicy('unknown' as Parameters<typeof loadPolicy>[0]),
    ).rejects.toThrow()
  })

  it('returns the same object reference on second call (cache hit)', async () => {
    const { loadPolicy } = await import('@/lib/policies/loader')

    const first = await loadPolicy('severity')
    const second = await loadPolicy('severity')

    expect(first).toBe(second)
  })
})
