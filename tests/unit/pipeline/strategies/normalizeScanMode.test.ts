import { describe, it, expect, vi } from 'vitest'
import { selectStrategy, normalizeScanMode } from '@/lib/pipeline/strategies/index'
import { QuickStrategy } from '@/lib/pipeline/strategies/quick'
import { StandardStrategy } from '@/lib/pipeline/strategies/standard'
import { OrchestratedStrategy } from '@/lib/pipeline/strategies/orchestrated'
import { HuntStrategy } from '@/lib/pipeline/strategies/hunt'
import { PlaybookStrategy } from '@/lib/pipeline/strategies/playbook'

describe('normalizeScanMode', () => {
  it("maps 'deep' to 'paranoid' and calls warn", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('deep', warn)
    expect(result).toBe('paranoid')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deep'))
  })

  it("maps unknown mode to 'standard' and calls warn", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('garbage', warn)
    expect(result).toBe('standard')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('garbage'))
  })

  it('passes valid modes through unchanged', () => {
    const warn = vi.fn()
    expect(normalizeScanMode('quick', warn)).toBe('quick')
    expect(normalizeScanMode('standard', warn)).toBe('standard')
    expect(normalizeScanMode('intermediate', warn)).toBe('intermediate')
    expect(normalizeScanMode('paranoid', warn)).toBe('paranoid')
    expect(warn).not.toHaveBeenCalled()
  })

  it('handles null/undefined gracefully', () => {
    const warn = vi.fn()
    expect(normalizeScanMode(null, warn)).toBe('standard')
    expect(normalizeScanMode(undefined, warn)).toBe('standard')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('does not throw when onWarn is not provided', () => {
    expect(normalizeScanMode('deep')).toBe('paranoid')
    expect(normalizeScanMode('unknown')).toBe('standard')
    expect(normalizeScanMode('quick')).toBe('quick')
  })
})

// ─── v0.3: hunt mode + playbook:* patterns ──────────────────────────────────

describe('normalizeScanMode — v0.3 extensions', () => {
  it("accepts 'hunt' as a valid mode and passes it through unchanged", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('hunt', warn)
    expect(result).toBe('hunt')
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts a valid playbook id with @version and passes it through unchanged', () => {
    const warn = vi.fn()
    const result = normalizeScanMode('playbook:find-ssrf@1.0.0', warn)
    expect(result).toBe('playbook:find-ssrf@1.0.0')
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts playbook id with complex name and version', () => {
    const warn = vi.fn()
    const result = normalizeScanMode('playbook:audit-auth-surface@2.1.3', warn)
    expect(result).toBe('playbook:audit-auth-surface@2.1.3')
    expect(warn).not.toHaveBeenCalled()
  })

  it("maps invalid playbook pattern (missing @version) to 'standard' with warn", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('playbook:find-ssrf', warn)
    expect(result).toBe('standard')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("maps 'playbook:' with empty name to 'standard' with warn", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('playbook:@1.0.0', warn)
    expect(result).toBe('standard')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("maps 'playbook:' with empty version to 'standard' with warn", () => {
    const warn = vi.fn()
    const result = normalizeScanMode('playbook:find-ssrf@', warn)
    expect(result).toBe('standard')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('selectStrategy — existing modes (sync-compatible)', () => {
  it('returns QuickStrategy for quick mode', async () => {
    const s = await selectStrategy('quick')
    expect(s).toBeInstanceOf(QuickStrategy)
    expect(s.id).toBe('quick')
  })

  it('returns StandardStrategy for standard mode', async () => {
    const s = await selectStrategy('standard')
    expect(s).toBeInstanceOf(StandardStrategy)
    expect(s.id).toBe('standard')
  })

  it('returns OrchestratedStrategy(intermediate) for intermediate mode', async () => {
    const s = await selectStrategy('intermediate')
    expect(s).toBeInstanceOf(OrchestratedStrategy)
    expect(s.id).toBe('intermediate')
  })

  it('returns OrchestratedStrategy(paranoid) for paranoid mode', async () => {
    const s = await selectStrategy('paranoid')
    expect(s).toBeInstanceOf(OrchestratedStrategy)
    expect(s.id).toBe('paranoid')
  })
})

// ─── v0.3: selectStrategy async + hunt/playbook cases ───────────────────────

describe('selectStrategy — v0.3 async hunt + playbook', () => {
  it('returns HuntStrategy instance for hunt mode', async () => {
    const s = await selectStrategy('hunt')
    expect(s).toBeInstanceOf(HuntStrategy)
    expect(s.id).toBe('hunt')
  })

  it('returns PlaybookStrategy instance for playbook:find-ssrf@1.0.0', async () => {
    const s = await selectStrategy('playbook:find-ssrf@1.0.0')
    expect(s).toBeInstanceOf(PlaybookStrategy)
    expect(s.id).toBe('playbook:find-ssrf@1.0.0')
  })

  it('returns PlaybookStrategy with correct id for complex playbook ref', async () => {
    const s = await selectStrategy('playbook:audit-auth@2.1.0')
    expect(s).toBeInstanceOf(PlaybookStrategy)
    expect(s.id).toBe('playbook:audit-auth@2.1.0')
  })

  it('selectStrategy is async (returns a Promise)', () => {
    const result = selectStrategy('quick')
    expect(result).toBeInstanceOf(Promise)
  })

  it('falls back to StandardStrategy for unknown mode', async () => {
    const s = await selectStrategy('unknown-mode' as never)
    expect(s).toBeInstanceOf(StandardStrategy)
  })
})
