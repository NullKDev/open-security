/**
 * tests/unit/dedup/extract-cves.test.ts
 *
 * TDD: T-C01 — CVE extraction util
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { extractCves } from '@/lib/dedup/extract-cves'

describe('extractCves', () => {
  describe('basic extraction', () => {
    it('extracts a single CVE from title + description for osv detector', () => {
      const cves = extractCves('osv', 'CVE-2024-1234 in lodash', undefined)
      expect(cves).toEqual(['CVE-2024-1234'])
    })

    it('extracts multiple CVEs from combined text', () => {
      const cves = extractCves('osv', 'Multiple issues: CVE-2024-1234', 'Also CVE-2023-99999')
      expect(cves).toContain('CVE-2024-1234')
      expect(cves).toContain('CVE-2023-99999')
      expect(cves).toHaveLength(2)
    })

    it('returns empty array for non-osv detector even if CVE in title', () => {
      const cves = extractCves('semgrep', 'CVE-2024-1234 vulnerability', undefined)
      expect(cves).toHaveLength(0)
    })

    it('returns empty array for gitleaks detector', () => {
      const cves = extractCves('gitleaks', 'CVE-2024-5678 secret', 'some CVE-2024-5678 description')
      expect(cves).toHaveLength(0)
    })
  })

  describe('CVE format handling', () => {
    it('matches 4-digit CVE IDs (e.g. CVE-2024-1234)', () => {
      const cves = extractCves('osv', 'CVE-2024-1234', undefined)
      expect(cves).toContain('CVE-2024-1234')
    })

    it('matches 5-digit CVE IDs (e.g. CVE-2021-44228)', () => {
      const cves = extractCves('osv', 'CVE-2021-44228 log4shell', undefined)
      expect(cves).toContain('CVE-2021-44228')
    })

    it('deduplicates repeated CVE IDs', () => {
      const cves = extractCves('osv', 'CVE-2024-1234', 'see CVE-2024-1234 for details')
      expect(cves).toEqual(['CVE-2024-1234'])
    })

    it('ignores text without CVE pattern', () => {
      const cves = extractCves('osv', 'SQL injection in login handler', 'No CVE assigned')
      expect(cves).toHaveLength(0)
    })
  })

  describe('undefined/null description handling', () => {
    it('handles undefined description gracefully', () => {
      const cves = extractCves('osv', 'CVE-2024-9999 title', undefined)
      expect(cves).toContain('CVE-2024-9999')
    })

    it('handles empty string description gracefully', () => {
      const cves = extractCves('osv', 'CVE-2024-9999 title', '')
      expect(cves).toContain('CVE-2024-9999')
    })
  })
})
