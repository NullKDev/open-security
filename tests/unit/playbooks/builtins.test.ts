/**
 * tests/unit/playbooks/builtins.test.ts
 *
 * TDD: T-016/T-017 — Builtin playbooks
 * Tests that all 5 builtin .obt-skill files pass schema validation.
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PlaybookManifestSchema } from '@/lib/playbooks/schema'
import { loadPlaybookFile } from '@/lib/playbooks/manifest-loader'

const BUILTINS_DIR = join(process.cwd(), 'lib', 'playbooks', 'builtins')

const EXPECTED_BUILTINS = [
  'audit-auth-surface',
  'find-ssrf',
  'pre-release-sweep',
  'deserialization-sweep',
  'oauth-flow-review',
]

describe('Builtin playbooks', () => {
  describe('all 5 builtins are present', () => {
    it('builtins directory contains exactly 5 .obt-skill files', () => {
      const files = readdirSync(BUILTINS_DIR).filter((f) => f.endsWith('.obt-skill'))
      expect(files).toHaveLength(5)
    })

    for (const name of EXPECTED_BUILTINS) {
      it(`${name}.obt-skill exists`, () => {
        const files = readdirSync(BUILTINS_DIR)
        expect(files).toContain(`${name}.obt-skill`)
      })
    }
  })

  describe('each builtin passes PlaybookManifestSchema.parse()', () => {
    for (const name of EXPECTED_BUILTINS) {
      it(`${name} is a valid playbook manifest`, () => {
        const filePath = join(BUILTINS_DIR, `${name}.obt-skill`)
        const result = loadPlaybookFile(filePath)
        expect(result).not.toBeNull()
        // Use schema parse directly as extra validation
        expect(() => PlaybookManifestSchema.parse(result)).not.toThrow()
      })

      it(`${name} has non-empty promptTemplate`, () => {
        const filePath = join(BUILTINS_DIR, `${name}.obt-skill`)
        const result = loadPlaybookFile(filePath)
        expect(result).not.toBeNull()
        expect(result!.promptTemplate.trim().length).toBeGreaterThan(10)
      })

      it(`${name} has source: builtin`, () => {
        const filePath = join(BUILTINS_DIR, `${name}.obt-skill`)
        const result = loadPlaybookFile(filePath)
        expect(result).not.toBeNull()
        expect(result!.source).toBe('builtin')
      })

      it(`${name} has builtIn: true`, () => {
        const filePath = join(BUILTINS_DIR, `${name}.obt-skill`)
        const result = loadPlaybookFile(filePath)
        expect(result).not.toBeNull()
        expect(result!.builtIn).toBe(true)
      })
    }
  })
})
