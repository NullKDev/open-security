import { describe, it, expect } from 'vitest'
import { ScanModeSchema } from '@/lib/api/schemas/scans'

describe('ScanModeSchema', () => {
  it('accepts quick', () => {
    expect(ScanModeSchema.parse('quick')).toBe('quick')
  })

  it('accepts standard', () => {
    expect(ScanModeSchema.parse('standard')).toBe('standard')
  })

  it('accepts intermediate', () => {
    expect(ScanModeSchema.parse('intermediate')).toBe('intermediate')
  })

  it('accepts paranoid', () => {
    expect(ScanModeSchema.parse('paranoid')).toBe('paranoid')
  })

  it('rejects deep with ZodError', () => {
    expect(() => ScanModeSchema.parse('deep')).toThrow()
  })

  it('rejects unknown modes with ZodError', () => {
    expect(() => ScanModeSchema.parse('turbo')).toThrow()
  })

  it('defaults to standard when undefined', () => {
    expect(ScanModeSchema.parse(undefined)).toBe('standard')
  })
})
