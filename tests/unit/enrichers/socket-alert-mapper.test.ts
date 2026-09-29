/**
 * tests/unit/enrichers/socket-alert-mapper.test.ts
 *
 * TDD RED → GREEN: T-022 — socket-alert-mapper
 *
 * Covers:
 * - All known alert types map to expected tag + severity
 * - Unknown alert type returns default mapping
 */
import { describe, it, expect } from 'vitest'
import { mapSocketAlert, SOCKET_DEFAULT_MAPPING } from '@/lib/enrichers/socket-alert-mapper'

describe('mapSocketAlert()', () => {
  it('malware → socket:malware, severity critical', () => {
    const result = mapSocketAlert('malware')
    expect(result.tag).toBe('socket:malware')
    expect(result.severity).toBe('critical')
  })

  it('protestware → socket:protestware, severity high', () => {
    const result = mapSocketAlert('protestware')
    expect(result.tag).toBe('socket:protestware')
    expect(result.severity).toBe('high')
  })

  it('typosquat → socket:typosquat, severity high', () => {
    const result = mapSocketAlert('typosquat')
    expect(result.tag).toBe('socket:typosquat')
    expect(result.severity).toBe('high')
  })

  it('suspicious-files → socket:suspicious-files, severity medium', () => {
    const result = mapSocketAlert('suspicious-files')
    expect(result.tag).toBe('socket:suspicious-files')
    expect(result.severity).toBe('medium')
  })

  it('obfuscated-code → socket:obfuscated-code, severity medium', () => {
    const result = mapSocketAlert('obfuscated-code')
    expect(result.tag).toBe('socket:obfuscated-code')
    expect(result.severity).toBe('medium')
  })

  it('hidden-payload → socket:hidden-payload, severity high', () => {
    const result = mapSocketAlert('hidden-payload')
    expect(result.tag).toBe('socket:hidden-payload')
    expect(result.severity).toBe('high')
  })

  it('network-access → socket:network-access, severity low', () => {
    const result = mapSocketAlert('network-access')
    expect(result.tag).toBe('socket:network-access')
    expect(result.severity).toBe('low')
  })

  it('filesystem-access → socket:filesystem-access, severity low', () => {
    const result = mapSocketAlert('filesystem-access')
    expect(result.tag).toBe('socket:filesystem-access')
    expect(result.severity).toBe('low')
  })

  it('license-change → socket:license-change, severity info', () => {
    const result = mapSocketAlert('license-change')
    expect(result.tag).toBe('socket:license-change')
    expect(result.severity).toBe('info')
  })

  it('unknown alert type → default mapping (socket:unknown, severity medium)', () => {
    const result = mapSocketAlert('totally-unknown-alert')
    expect(result.tag).toBe(SOCKET_DEFAULT_MAPPING.tag)
    expect(result.severity).toBe(SOCKET_DEFAULT_MAPPING.severity)
    expect(result.tag).toBe('socket:unknown')
    expect(result.severity).toBe('medium')
  })

  it('empty string → default mapping', () => {
    const result = mapSocketAlert('')
    expect(result.tag).toBe('socket:unknown')
  })
})
