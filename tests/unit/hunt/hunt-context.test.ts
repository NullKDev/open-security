/**
 * tests/unit/hunt/hunt-context.test.ts
 *
 * TDD: T-008/T-009 — HuntContext + buildHuntPrompt()
 * Tests for CVE class-specific prompt generation.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { buildHuntPrompt, type HuntContext } from '@/lib/hunt/hunt-context'

describe('buildHuntPrompt()', () => {
  describe('injection class', () => {
    it('returns non-empty string for injection class', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-0001',
        cveClass: 'injection',
        summary: 'SQL injection vulnerability',
        targetPath: '/src/db/query.ts',
      }
      const result = buildHuntPrompt(ctx)
      expect(result.length).toBeGreaterThan(0)
    })

    it('injection template contains cveId', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-1234',
        cveClass: 'injection',
        targetPath: '/src/db',
      }
      const result = buildHuntPrompt(ctx)
      expect(result).toContain('CVE-2024-1234')
    })

    it('injection template contains targetPath', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-5678',
        cveClass: 'injection',
        targetPath: '/src/controllers',
      }
      const result = buildHuntPrompt(ctx)
      expect(result).toContain('/src/controllers')
    })
  })

  describe('generic class', () => {
    it('generic class uses the generic template (returns non-empty)', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-9999',
        cveClass: 'generic',
        targetPath: '/src',
      }
      const result = buildHuntPrompt(ctx)
      expect(result.length).toBeGreaterThan(0)
    })

    it('generic template contains cveId', () => {
      const ctx: HuntContext = {
        cveId: 'GHSA-abcd-efgh-ijkl',
        cveClass: 'generic',
        targetPath: '/src',
      }
      const result = buildHuntPrompt(ctx)
      expect(result).toContain('GHSA-abcd-efgh-ijkl')
    })
  })

  describe('pocUrl handling', () => {
    it('includes PoC line when pocUrl is provided', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-0001',
        cveClass: 'rce',
        targetPath: '/src',
        pocUrl: 'https://poc.example.com/exploit',
      }
      const result = buildHuntPrompt(ctx)
      expect(result).toContain('https://poc.example.com/exploit')
    })

    it('omits PoC line when pocUrl is null', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-0001',
        cveClass: 'rce',
        targetPath: '/src',
        pocUrl: null,
      }
      const result = buildHuntPrompt(ctx)
      // Should not have any PoC reference
      expect(result).not.toContain('null')
      expect(result).not.toContain('pocUrl')
    })

    it('omits PoC line when pocUrl is undefined', () => {
      const ctx: HuntContext = {
        cveId: 'CVE-2024-0001',
        cveClass: 'xss',
        targetPath: '/src',
      }
      const result = buildHuntPrompt(ctx)
      expect(result).not.toContain('undefined')
    })
  })

  describe('all 8 templates are defined', () => {
    const classes: HuntContext['cveClass'][] = [
      'injection', 'path-traversal', 'deserialization', 'ssrf',
      'auth-bypass', 'rce', 'xss', 'generic',
    ]

    for (const cveClass of classes) {
      it(`${cveClass} template returns non-empty result`, () => {
        const ctx: HuntContext = {
          cveId: 'CVE-2024-0001',
          cveClass,
          targetPath: '/src',
        }
        const result = buildHuntPrompt(ctx)
        expect(result.length).toBeGreaterThan(10)
      })
    }
  })
})
