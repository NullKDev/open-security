import { describe, it, expect, beforeEach } from 'vitest'
import { redact, registerSecret, __clearRegisteredSecrets } from '@/lib/security/redact'

describe('redact', () => {
  beforeEach(() => {
    __clearRegisteredSecrets()
  })

  it('redacts Bearer tokens', () => {
    const result = redact('Bearer sk-ant-api123abc')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('sk-ant-api123abc')
  })

  it('redacts AWS access keys (AKIA shape)', () => {
    const result = redact('AKIA1234567890ABCDEF')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('AKIA1234567890ABCDEF')
  })

  it('redacts GitHub PAT in Authorization header', () => {
    const result = redact('Authorization: Bearer ghp_abc123def456ghi789jkl012mno345pqr678')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('ghp_abc123def456ghi789jkl012mno345pqr678')
  })

  it('leaves plain strings unchanged', () => {
    const result = redact('hello world')
    expect(result).toBe('hello world')
  })

  it('redacts password query param value', () => {
    const result = redact('password=supersecret&other=value')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('supersecret')
    expect(result).toContain('other=value')
  })
})

describe('registerSecret', () => {
  beforeEach(() => {
    __clearRegisteredSecrets()
  })

  it('registered value is replaced with [REDACTED]', () => {
    registerSecret('my-runtime-secret-token')
    const result = redact('the value is my-runtime-secret-token in the payload')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('my-runtime-secret-token')
  })

  it('unregistered value passes through unchanged', () => {
    const result = redact('the value is some-other-token')
    expect(result).toBe('the value is some-other-token')
  })

  it('all occurrences of a registered secret are replaced', () => {
    registerSecret('secret123')
    const result = redact('secret123 and again secret123')
    expect(result).toBe('[REDACTED] and again [REDACTED]')
  })

  it('empty string is not registered (no-op)', () => {
    registerSecret('')
    const result = redact('hello world')
    expect(result).toBe('hello world')
  })

  it('multiple registered secrets are all redacted', () => {
    registerSecret('token-a')
    registerSecret('token-b')
    const result = redact('use token-a and token-b together')
    expect(result).not.toContain('token-a')
    expect(result).not.toContain('token-b')
    expect(result).toContain('[REDACTED]')
  })
})
