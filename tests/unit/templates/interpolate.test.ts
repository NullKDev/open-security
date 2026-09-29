/**
 * tests/unit/templates/interpolate.test.ts
 *
 * TDD: T-018 — Template interpolation engine
 * Tests for the {{var}} substitution utility.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { interpolate } from '@/lib/templates/interpolate'

describe('interpolate()', () => {
  describe('basic substitution', () => {
    it('replaces a single {{var}} placeholder', () => {
      const result = interpolate('Hello {{name}}!', { name: 'world' })
      expect(result).toBe('Hello world!')
    })

    it('replaces multiple distinct placeholders', () => {
      const result = interpolate('CVE: {{cveId}}, path: {{targetPath}}', {
        cveId: 'CVE-2024-0001',
        targetPath: '/src/app',
      })
      expect(result).toBe('CVE: CVE-2024-0001, path: /src/app')
    })

    it('replaces the same placeholder multiple times', () => {
      const result = interpolate('{{x}} and {{x}}', { x: 'foo' })
      expect(result).toBe('foo and foo')
    })
  })

  describe('unknown variables', () => {
    it('leaves unknown vars as-is', () => {
      const result = interpolate('Hello {{unknown}}!', {})
      expect(result).toBe('Hello {{unknown}}!')
    })

    it('leaves unknown vars as-is while substituting known ones', () => {
      const result = interpolate('{{known}} and {{unknown}}', { known: 'yes' })
      expect(result).toBe('yes and {{unknown}}')
    })
  })

  describe('empty / edge cases', () => {
    it('returns empty string unchanged', () => {
      const result = interpolate('', { foo: 'bar' })
      expect(result).toBe('')
    })

    it('returns template unchanged when no vars provided', () => {
      const result = interpolate('No placeholders here.', {})
      expect(result).toBe('No placeholders here.')
    })

    it('handles template with no placeholders and vars provided', () => {
      const result = interpolate('static text', { a: '1', b: '2' })
      expect(result).toBe('static text')
    })
  })

  describe('no eval / safe substitution', () => {
    it('does not evaluate expressions inside placeholders', () => {
      const result = interpolate('{{1 + 1}}', {})
      // '1 + 1' is not a valid \w+ identifier, so it stays as-is
      expect(result).toBe('{{1 + 1}}')
    })

    it('only matches word characters (\\w+) — ignores special chars in var names', () => {
      const result = interpolate('{{ dangerous }}', { ' dangerous ': 'nope' })
      // Spaces inside braces: \w+ won't match spaces, stays as-is
      expect(result).toBe('{{ dangerous }}')
    })
  })
})
