import { describe, it, expect } from 'vitest'
import { parseSkillRegistry, resolveRulesForStack, resolveRulesForDomain, loadCompactRules } from '@/lib/skills/registry'
import * as path from 'node:path'

const FIXTURE_MARKDOWN = `
# Skill Registry

## Compact Rules

### next-js-security
**Triggers**: next.js, nextjs, react
**Source**: skills/next-js-security.md

Always validate API route inputs with Zod. Use Server Actions securely.

### sql-injection
**Triggers**: sql, postgres, mysql, sqlite
**Source**: skills/sql-injection.md

Use parameterized queries. Never concatenate user input into SQL strings.

### auth-patterns
**Triggers**: auth, jwt, session, oauth
**Source**: skills/auth-patterns.md

Use httpOnly cookies. Rotate refresh tokens. Validate JWT audience.
`

describe('parseSkillRegistry', () => {
  it('returns empty array for empty markdown', () => {
    const rules = parseSkillRegistry('')
    expect(rules).toHaveLength(0)
  })

  it('parses compact rules section correctly', () => {
    const rules = parseSkillRegistry(FIXTURE_MARKDOWN)
    expect(rules.length).toBeGreaterThan(0)
  })

  it('each rule has skillId, triggers, source, and body', () => {
    const rules = parseSkillRegistry(FIXTURE_MARKDOWN)
    const sqlRule = rules.find((r) => r.skillId === 'sql-injection')
    expect(sqlRule).toBeDefined()
    expect(sqlRule!.triggers).toContain('sql')
    expect(sqlRule!.triggers).toContain('sqlite')
    expect(sqlRule!.source).toBe('skills/sql-injection.md')
    expect(sqlRule!.body).toContain('parameterized')
  })

  it('triggers are lowercased', () => {
    const rules = parseSkillRegistry(FIXTURE_MARKDOWN)
    for (const rule of rules) {
      for (const trigger of rule.triggers) {
        expect(trigger).toBe(trigger.toLowerCase())
      }
    }
  })
})

describe('resolveRulesForStack', () => {
  it('returns matching rule body for known stack token', () => {
    const result = resolveRulesForStack(['next.js', 'typescript'], FIXTURE_MARKDOWN)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('## Security Skills')
  })

  it('known stack result is non-empty and under 4 KB', () => {
    const result = resolveRulesForStack(['next.js', 'typescript'], FIXTURE_MARKDOWN)
    expect(result.length).toBeGreaterThan(0)
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(4096)
  })

  it('returns empty string when no stack tokens match', () => {
    const result = resolveRulesForStack(['ruby', 'rails'], FIXTURE_MARKDOWN)
    expect(result).toBe('')
  })

  it('returns empty string when registry markdown has no matching rules for stack', () => {
    const nonMatchingMd = `
# Skill Registry
## Compact Rules
### ruby-security
**Triggers**: ruby, rails
**Source**: skills/ruby-security.md
Use secure cookies.
`
    const result = resolveRulesForStack(['next.js', 'typescript'], nonMatchingMd)
    expect(result).toBe('')
  })

  it('caps output at MAX_RULES_BYTES (4096 bytes)', () => {
    const bigMarkdown = FIXTURE_MARKDOWN.repeat(100)
    const result = resolveRulesForStack(['next.js'], bigMarkdown)
    expect(result.length).toBeLessThanOrEqual(4096 + 50) // header overhead
  })
})

describe('resolveRulesForDomain', () => {
  it('matches domain keyword to rule', () => {
    const result = resolveRulesForDomain('auth', ['next.js'], FIXTURE_MARKDOWN)
    expect(result).toContain('## Security Skills')
    expect(result).toContain('httpOnly')
  })

  it('falls back to stack match when domain has no specific rule', () => {
    const result = resolveRulesForDomain('cryptography', ['next.js'], FIXTURE_MARKDOWN)
    // no cryptography rule, but next.js stack matches next-js-security
    expect(result).toContain('## Security Skills')
  })

  it('returns empty string when neither domain nor stack match', () => {
    const result = resolveRulesForDomain('unknown-domain', ['cobol'], FIXTURE_MARKDOWN)
    expect(result).toBe('')
  })

  it('returns empty string when registry markdown has no matching rules for domain', () => {
    const nonMatchingMd = `
# Skill Registry
## Compact Rules
### ruby-security
**Triggers**: ruby, rails
**Source**: skills/ruby-security.md
Use secure cookies.
`
    const result = resolveRulesForDomain('auth', ['next.js'], nonMatchingMd)
    expect(result).toBe('')
  })
})

describe('loadCompactRules — missing file', () => {
  it('returns empty array when registry file does not exist', () => {
    const rules = loadCompactRules('/nonexistent/path/to/project')
    expect(rules).toEqual([])
  })

  it('does not throw when registry file is missing', () => {
    expect(() => loadCompactRules('/nonexistent/path')).not.toThrow()
  })
})
