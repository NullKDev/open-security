/**
 * tests/unit/webhook/github-signature.test.ts
 *
 * TDD: T-C01 — HMAC signature validation
 * RED → GREEN → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { validateGithubSignature } from '@/lib/webhook/github-signature'

function makeSignature(payload: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

describe('validateGithubSignature', () => {
  const secret = 'my-webhook-secret'
  const payload = Buffer.from('{"action":"opened"}')

  it('returns true for a valid signature', () => {
    const sig = makeSignature(payload, secret)
    expect(validateGithubSignature(payload, sig, secret)).toBe(true)
  })

  it('returns false for a tampered payload', () => {
    const sig = makeSignature(payload, secret)
    const tampered = Buffer.from('{"action":"closed"}')
    expect(validateGithubSignature(tampered, sig, secret)).toBe(false)
  })

  it('returns false for wrong secret', () => {
    const sig = makeSignature(payload, 'wrong-secret')
    expect(validateGithubSignature(payload, sig, secret)).toBe(false)
  })

  it('returns false when signature header is missing (empty string)', () => {
    expect(validateGithubSignature(payload, '', secret)).toBe(false)
  })

  it('returns false for a signature without the sha256= prefix', () => {
    const hmac = createHmac('sha256', secret)
    hmac.update(payload)
    const rawHex = hmac.digest('hex')
    // No prefix — should be rejected
    expect(validateGithubSignature(payload, rawHex, secret)).toBe(false)
  })

  it('uses constant-time comparison (does not throw on length mismatch)', () => {
    // Different-length signature should return false without throwing
    expect(() => validateGithubSignature(payload, 'sha256=abc', secret)).not.toThrow()
    expect(validateGithubSignature(payload, 'sha256=abc', secret)).toBe(false)
  })

  it('returns false for undefined/null signature gracefully', () => {
    // Guard: callers may pass null/undefined from untrusted headers
    expect(validateGithubSignature(payload, null as unknown as string, secret)).toBe(false)
    expect(validateGithubSignature(payload, undefined as unknown as string, secret)).toBe(false)
  })
})
