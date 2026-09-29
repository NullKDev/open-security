/**
 * tests/unit/config/workspace.test.ts
 *
 * TDD: T-020 — Workspace path helpers for playbook directories
 * Tests for userPlaybooksDir(), workspacePlaybooksDir(), and builtinPlaybooksDir().
 *
 * RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  userPlaybooksDir,
  workspacePlaybooksDir,
  builtinPlaybooksDir,
} from '@/lib/config/workspace'

describe('Workspace playbook path helpers', () => {
  describe('builtinPlaybooksDir()', () => {
    it('returns an absolute path', () => {
      const dir = builtinPlaybooksDir()
      expect(dir.startsWith('/')).toBe(true)
    })

    it('path ends with a playbooks directory component', () => {
      const dir = builtinPlaybooksDir()
      expect(dir).toMatch(/builtins$/)
    })

    it('returns the same value on repeated calls', () => {
      expect(builtinPlaybooksDir()).toBe(builtinPlaybooksDir())
    })
  })

  describe('userPlaybooksDir()', () => {
    it('returns an absolute path', () => {
      const dir = userPlaybooksDir()
      expect(dir.startsWith('/')).toBe(true)
    })

    it('includes .obt in the path (user home directory scope)', () => {
      const dir = userPlaybooksDir()
      expect(dir).toContain('.obt')
    })

    it('returns the same value on repeated calls (deterministic)', () => {
      expect(userPlaybooksDir()).toBe(userPlaybooksDir())
    })
  })

  describe('workspacePlaybooksDir()', () => {
    it('returns an absolute path based on the provided workspace root', () => {
      const root = '/tmp/my-project'
      const dir = workspacePlaybooksDir(root)
      expect(dir.startsWith('/')).toBe(true)
    })

    it('incorporates the workspace root in the returned path', () => {
      const root = '/tmp/my-project'
      const dir = workspacePlaybooksDir(root)
      expect(dir).toContain(root)
    })

    it('different workspace roots produce different paths', () => {
      const dir1 = workspacePlaybooksDir('/tmp/project-a')
      const dir2 = workspacePlaybooksDir('/tmp/project-b')
      expect(dir1).not.toBe(dir2)
    })

    it('is deterministic for the same workspace root', () => {
      const root = '/tmp/consistent'
      expect(workspacePlaybooksDir(root)).toBe(workspacePlaybooksDir(root))
    })
  })
})
