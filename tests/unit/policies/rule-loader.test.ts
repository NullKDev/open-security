/**
 * tests/unit/policies/rule-loader.test.ts
 *
 * TDD RED → GREEN: T-008 + T-009 — loadPolicyRules
 *
 * Covers:
 * - Workspace policy overrides global rules for overlapping ids
 * - Missing both files → empty rules array (no error)
 * - Invalid YAML → Zod error thrown
 * - Expired rules are loaded (not filtered at loader level)
 * - Merge order preserved (global first, workspace overrides)
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPolicyRules } from '@/lib/policies/rule-loader'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `obt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeYaml(dir: string, relPath: string, content: string): void {
  const fullPath = join(dir, relPath)
  mkdirSync(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

const VALID_GLOBAL_YAML = `
rules:
  - id: rule-global-1
    type: suppress
    match:
      path: "**/*.test.ts"
    decision:
      suppress: true
  - id: rule-global-2
    type: severity_floor
    match:
      severity: low
    decision:
      severity: medium
`

const VALID_WORKSPACE_YAML = `
rules:
  - id: rule-ws-1
    type: assign
    match:
      path: "src/**"
    decision:
      assignee: "alice"
  - id: rule-global-1
    type: ignore
    match:
      path: "**/*.test.ts"
    decision:
      suppress: false
`

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadPolicyRules', () => {
  it('returns empty array when both policy files are missing', async () => {
    const dir = makeTmpDir()
    try {
      const rules = await loadPolicyRules({ workspaceRoot: dir, homeDir: dir })
      expect(rules).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads global rules when workspace file is missing', async () => {
    const dir = makeTmpDir()
    try {
      writeYaml(dir, '.obt/policies.yaml', VALID_GLOBAL_YAML)
      const rules = await loadPolicyRules({ workspaceRoot: dir, homeDir: dir })
      expect(rules.length).toBe(2)
      expect(rules.map((r) => r.id)).toContain('rule-global-1')
      expect(rules.map((r) => r.id)).toContain('rule-global-2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('workspace rules override global rules with same id', async () => {
    const dir = makeTmpDir()
    try {
      writeYaml(dir, '.obt/policies.yaml', VALID_WORKSPACE_YAML)

      // Write global in a separate "home" dir
      const homeDir = makeTmpDir()
      writeYaml(homeDir, '.obt/policies.yaml', VALID_GLOBAL_YAML)

      const rules = await loadPolicyRules({ workspaceRoot: dir, homeDir })

      // rule-global-1 is overridden by workspace — workspace version has type: ignore
      const rule1 = rules.find((r) => r.id === 'rule-global-1')
      expect(rule1).toBeDefined()
      expect(rule1!.type).toBe('ignore')

      // rule-global-2 comes from global (not in workspace)
      const rule2 = rules.find((r) => r.id === 'rule-global-2')
      expect(rule2).toBeDefined()
      expect(rule2!.type).toBe('severity_floor')

      // rule-ws-1 comes from workspace
      const ruleWs = rules.find((r) => r.id === 'rule-ws-1')
      expect(ruleWs).toBeDefined()
      expect(ruleWs!.type).toBe('assign')

      rmSync(homeDir, { recursive: true, force: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('loads workspace-only rules when global file is missing', async () => {
    const dir = makeTmpDir()
    try {
      writeYaml(dir, '.obt/policies.yaml', VALID_WORKSPACE_YAML)
      const homeDir = makeTmpDir()
      // No global file in homeDir

      const rules = await loadPolicyRules({ workspaceRoot: dir, homeDir })
      expect(rules.length).toBe(2)
      expect(rules.map((r) => r.id)).toContain('rule-ws-1')
      expect(rules.map((r) => r.id)).toContain('rule-global-1')

      rmSync(homeDir, { recursive: true, force: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws ZodError on invalid YAML schema', async () => {
    const dir = makeTmpDir()
    try {
      writeYaml(dir, '.obt/policies.yaml', `
rules:
  - id: 123
    type: unknown_type
    match: {}
    decision: {}
`)
      await expect(
        loadPolicyRules({ workspaceRoot: dir, homeDir: dir })
      ).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('expired rules are loaded (not filtered at loader level)', async () => {
    const dir = makeTmpDir()
    try {
      writeYaml(dir, '.obt/policies.yaml', `
rules:
  - id: expired-rule
    type: ignore
    match:
      path: "**/*.ts"
    decision:
      suppress: true
      expiresAt: "2020-01-01"
`)
      const rules = await loadPolicyRules({ workspaceRoot: dir, homeDir: dir })
      expect(rules.length).toBe(1)
      expect(rules[0].id).toBe('expired-rule')
      expect(rules[0].decision.expiresAt).toBe('2020-01-01')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
