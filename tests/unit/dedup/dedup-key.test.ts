/**
 * tests/unit/dedup/dedup-key.test.ts
 *
 * TDD: T-B03 — computeDedupKey pure utility
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { computeDedupKey } from '@/lib/dedup/dedup-key'

describe('computeDedupKey', () => {
  describe('determinism', () => {
    it('same inputs produce the same key', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection in query')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection in query')
      expect(a).toBe(b)
    })

    it('returns a 64-character hex string (SHA-256)', () => {
      const key = computeDedupKey('gitleaks', 'config.yaml', 'AWS Key exposed')
      expect(key).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('normalization — whitespace variants produce the same key', () => {
    it('leading/trailing whitespace is stripped before hashing', () => {
      const a = computeDedupKey('  semgrep  ', '  src/auth/login.ts  ', '  SQL Injection  ')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection')
      expect(a).toBe(b)
    })

    it('internal multiple spaces collapsed to single space', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL  Injection  in   query')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection in query')
      expect(a).toBe(b)
    })

    it('tab characters treated as whitespace and collapsed', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL\tInjection')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection')
      expect(a).toBe(b)
    })

    it('case-insensitive — uppercase and lowercase produce the same key', () => {
      const a = computeDedupKey('SEMGREP', 'SRC/AUTH/LOGIN.TS', 'SQL INJECTION')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'sql injection')
      expect(a).toBe(b)
    })
  })

  describe('uniqueness — different inputs produce different keys', () => {
    it('different location_path produces different key', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection')
      const b = computeDedupKey('semgrep', 'src/payments/pay.ts', 'SQL Injection')
      expect(a).not.toBe(b)
    })

    it('different detector produces different key', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection')
      const b = computeDedupKey('gitleaks', 'src/auth/login.ts', 'SQL Injection')
      expect(a).not.toBe(b)
    })

    it('different title produces different key', () => {
      const a = computeDedupKey('semgrep', 'src/auth/login.ts', 'SQL Injection')
      const b = computeDedupKey('semgrep', 'src/auth/login.ts', 'XSS vulnerability')
      expect(a).not.toBe(b)
    })
  })
})
