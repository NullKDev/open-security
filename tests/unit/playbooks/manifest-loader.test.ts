/**
 * tests/unit/playbooks/manifest-loader.test.ts
 *
 * TDD: T-012/T-013 — ManifestLoader + PlaybookSchema
 * Tests for YAML playbook manifest parsing and discovery.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { PlaybookManifestSchema } from '@/lib/playbooks/schema'

describe('PlaybookManifestSchema', () => {
  describe('valid manifest → Playbook', () => {
    it('parses a minimal valid manifest', () => {
      const raw = {
        id: 'find-ssrf',
        name: 'Find SSRF',
        version: '1.0.0',
        promptTemplate: 'Check for SSRF in {{targetPath}}',
        source: 'user' as const,
      }
      const result = PlaybookManifestSchema.parse(raw)
      expect(result.id).toBe('find-ssrf')
      expect(result.name).toBe('Find SSRF')
      expect(result.version).toBe('1.0.0')
      expect(result.promptTemplate).toBe('Check for SSRF in {{targetPath}}')
      expect(result.source).toBe('user')
    })

    it('parses a full manifest with optional fields', () => {
      const raw = {
        id: 'audit-auth',
        name: 'Audit Auth Surface',
        version: '2.0.0',
        description: 'Reviews authentication entry points',
        promptTemplate: 'Audit auth at {{targetPath}} for {{cveId}}',
        scannerScope: ['semgrep', 'gitleaks'],
        parameters: { severity: 'high', maxFindings: 10 },
        source: 'builtin' as const,
        builtIn: true,
        trusted: true,
      }
      const result = PlaybookManifestSchema.parse(raw)
      expect(result.description).toBe('Reviews authentication entry points')
      expect(result.scannerScope).toEqual(['semgrep', 'gitleaks'])
      expect(result.builtIn).toBe(true)
      expect(result.trusted).toBe(true)
    })
  })

  describe('missing required fields → ZodError', () => {
    it('missing promptTemplate → ZodError', () => {
      const raw = {
        id: 'no-template',
        name: 'No Template',
        version: '1.0.0',
        source: 'user',
        // promptTemplate intentionally missing
      }
      expect(() => PlaybookManifestSchema.parse(raw)).toThrow(ZodError)
    })

    it('missing id → ZodError', () => {
      const raw = {
        name: 'No ID',
        version: '1.0.0',
        promptTemplate: 'Some template',
        source: 'user',
      }
      expect(() => PlaybookManifestSchema.parse(raw)).toThrow(ZodError)
    })

    it('missing name → ZodError', () => {
      const raw = {
        id: 'no-name',
        version: '1.0.0',
        promptTemplate: 'Some template',
        source: 'user',
      }
      expect(() => PlaybookManifestSchema.parse(raw)).toThrow(ZodError)
    })

    it('invalid source value → ZodError', () => {
      const raw = {
        id: 'bad-source',
        name: 'Bad Source',
        version: '1.0.0',
        promptTemplate: 'template',
        source: 'unknown', // not 'user' | 'builtin'
      }
      expect(() => PlaybookManifestSchema.parse(raw)).toThrow(ZodError)
    })
  })
})
