import { describe, it, expect } from 'vitest'
import {
  ProjectMapSchema,
  extractFirstJsonObject,
  defaultProjectMapFromStack,
} from '@/lib/pipeline/project-map'

describe('ProjectMapSchema', () => {
  it('parses a valid project map', () => {
    const data = {
      stack: ['next.js', 'typescript'],
      frameworks: ['next.js'],
      entryPoints: ['app/api/route.ts'],
      attackSurface: ['http-api', 'file-upload'],
      domains: ['auth', 'input'],
      relevantSkillIds: ['next-js-security'],
    }
    const result = ProjectMapSchema.parse(data)
    expect(result.stack).toEqual(['next.js', 'typescript'])
    expect(result.domains).toEqual(['auth', 'input'])
  })

  it('round-trip preserves all fields through parse (successful Zod validation)', () => {
    const data = {
      stack: ['next.js', 'typescript', 'tailwind'],
      frameworks: ['next.js', 'prisma'],
      entryPoints: ['app/api/route.ts', 'app/layout.tsx'],
      attackSurface: ['http-api', 'file-upload', 'auth', 'sql'],
      domains: ['auth', 'input-validation', 'data-access', 'api-security'],
      relevantSkillIds: ['next-best-practices', 'tailwind-css-patterns'],
    }
    const result = ProjectMapSchema.parse(data)
    expect(result.stack).toEqual(data.stack)
    expect(result.frameworks).toEqual(data.frameworks)
    expect(result.entryPoints).toEqual(data.entryPoints)
    expect(result.attackSurface).toEqual(data.attackSurface)
    expect(result.domains).toEqual(data.domains)
    expect(result.relevantSkillIds).toEqual(data.relevantSkillIds)
  })

  it('rejects domains array with more than 7 items', () => {
    const data = {
      stack: [],
      frameworks: [],
      entryPoints: [],
      attackSurface: [],
      domains: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      relevantSkillIds: [],
    }
    expect(() => ProjectMapSchema.parse(data)).toThrow()
  })

  it('requires at least 1 domain', () => {
    const data = {
      stack: [],
      frameworks: [],
      entryPoints: [],
      attackSurface: [],
      domains: [],
      relevantSkillIds: [],
    }
    expect(() => ProjectMapSchema.parse(data)).toThrow()
  })
})

describe('extractFirstJsonObject', () => {
  it('extracts JSON from plain JSON string', () => {
    const text = '{"stack":["next.js"],"domains":["auth"]}'
    const result = extractFirstJsonObject(text)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toMatchObject({ stack: ['next.js'] })
  })

  it('extracts JSON wrapped in prose', () => {
    const text = 'Here is my analysis:\n\n{"stack":["go"],"domains":["auth","input"]}\n\nDone.'
    const result = extractFirstJsonObject(text)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.domains).toContain('auth')
  })

  it('extracts JSON from markdown code fence block', () => {
    const text = '```json\n{"stack":["python"],"domains":["auth","input-validation"]}\n```'
    const result = extractFirstJsonObject(text)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.stack).toEqual(['python'])
  })

  it('handles nested JSON objects', () => {
    const text = 'Output: {"a":{"b":1},"domains":["x"]}'
    const result = extractFirstJsonObject(text)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!).a.b).toBe(1)
  })

  it('returns null for text with no JSON object', () => {
    const result = extractFirstJsonObject('no json here at all')
    expect(result).toBeNull()
  })
})

describe('defaultProjectMapFromStack', () => {
  it('returns 3-4 domains for intermediate variant', () => {
    const map = defaultProjectMapFromStack(['next.js', 'typescript'], 'intermediate')
    expect(map.domains.length).toBeGreaterThanOrEqual(3)
    expect(map.domains.length).toBeLessThanOrEqual(4)
  })

  it('returns exactly 4 domains for intermediate variant', () => {
    const map = defaultProjectMapFromStack(['svelte'], 'intermediate')
    expect(map.domains).toHaveLength(4)
  })

  it('returns 5-7 domains for paranoid variant', () => {
    const map = defaultProjectMapFromStack(['next.js', 'postgres'], 'paranoid')
    expect(map.domains.length).toBeGreaterThanOrEqual(5)
    expect(map.domains.length).toBeLessThanOrEqual(7)
  })

  it('returns exactly 7 domains for paranoid variant', () => {
    const map = defaultProjectMapFromStack(['go'], 'paranoid')
    expect(map.domains).toHaveLength(7)
  })

  it('includes stack tokens in the returned map', () => {
    const map = defaultProjectMapFromStack(['python', 'django'], 'intermediate')
    expect(map.stack).toContain('python')
  })

  it('domains array satisfies ProjectMapSchema', () => {
    const map = defaultProjectMapFromStack(['node.js'], 'paranoid')
    expect(() => ProjectMapSchema.parse(map)).not.toThrow()
  })
})
