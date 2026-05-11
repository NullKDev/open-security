/**
 * tests/design-system/tokens.test.ts
 *
 * Verifies that semantic CSS tokens in globals.css resolve to the correct
 * values for both light (:root) and dark ([data-theme="dark"]) themes.
 *
 * Strategy: parse globals.css as text and extract token values by matching
 * CSS custom property declarations within each rule block. This is reliable
 * and avoids the complexity of spinning up a CSS engine in JSDOM.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

let css: string

beforeAll(() => {
  const cssPath = path.resolve(__dirname, '../../app/globals.css')
  css = fs.readFileSync(cssPath, 'utf-8')
})

/**
 * Extracts the value of a CSS custom property from a given block of text.
 * Returns null if not found.
 */
function extractToken(block: string, name: string): string | null {
  const regex = new RegExp(`${name}\\s*:\\s*([^;]+);`)
  const match = block.match(regex)
  return match ? match[1].trim() : null
}

/**
 * Extracts the content of a CSS rule block by selector prefix.
 * Returns the text between the first matching `{` and its closing `}`.
 */
function extractBlock(source: string, selector: string): string {
  const idx = source.indexOf(selector)
  if (idx === -1) return ''
  const start = source.indexOf('{', idx)
  if (start === -1) return ''
  let depth = 1
  let i = start + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(start + 1, i - 1)
}

describe('Design token — :root (light theme)', () => {
  let root: string

  beforeAll(() => {
    root = extractBlock(css, ':root')
  })

  it('--accent resolves to #f97316', () => {
    const value = extractToken(root, '--accent')
    // Must be the orange brand color, not a near-white OKLCH value
    expect(value).toBe('#f97316')
  })

  it('--accent-hover resolves to #ea580c', () => {
    const value = extractToken(root, '--accent-hover')
    expect(value).toBe('#ea580c')
  })

  it('--border resolves to #e5e5e5', () => {
    const value = extractToken(root, '--border')
    expect(value).toBe('#e5e5e5')
  })

  it('--bg resolves to #ffffff', () => {
    const value = extractToken(root, '--bg')
    expect(value).toBe('#ffffff')
  })

  it('--fg resolves to #0a0a0a', () => {
    const value = extractToken(root, '--fg')
    expect(value).toBe('#0a0a0a')
  })

  it('--danger resolves to #ef4444', () => {
    const value = extractToken(root, '--danger')
    expect(value).toBe('#ef4444')
  })

  it('--warning resolves to #f59e0b', () => {
    const value = extractToken(root, '--warning')
    expect(value).toBe('#f59e0b')
  })

  it('--success resolves to #10b981', () => {
    const value = extractToken(root, '--success')
    expect(value).toBe('#10b981')
  })
})

describe('Design token — [data-theme="dark"] (dark theme)', () => {
  let dark: string

  beforeAll(() => {
    dark = extractBlock(css, '[data-theme="dark"]')
  })

  it('--accent resolves to #f97316 (same as light — spec requirement)', () => {
    const value = extractToken(dark, '--accent')
    expect(value).toBe('#f97316')
  })

  it('--accent-hover resolves to #ea580c', () => {
    const value = extractToken(dark, '--accent-hover')
    expect(value).toBe('#ea580c')
  })

  it('--bg resolves to #0a0a0a', () => {
    const value = extractToken(dark, '--bg')
    expect(value).toBe('#0a0a0a')
  })

  it('--fg resolves to #fafafa', () => {
    const value = extractToken(dark, '--fg')
    expect(value).toBe('#fafafa')
  })

  it('--border resolves to #2a2a2a', () => {
    const value = extractToken(dark, '--border')
    expect(value).toBe('#2a2a2a')
  })
})

describe('Design token — @theme inline block (Tailwind v4 utility mapping)', () => {
  let theme: string

  beforeAll(() => {
    theme = extractBlock(css, '@theme inline')
  })

  it('--color-accent maps to var(--accent)', () => {
    const value = extractToken(theme, '--color-accent')
    expect(value).toBe('var(--accent)')
  })

  it('--color-accent-hover maps to var(--accent-hover)', () => {
    const value = extractToken(theme, '--color-accent-hover')
    expect(value).toBe('var(--accent-hover)')
  })

  it('--color-danger maps to var(--danger)', () => {
    const value = extractToken(theme, '--color-danger')
    expect(value).toBe('var(--danger)')
  })

  it('--font-sans maps to var(--font-sans)', () => {
    const value = extractToken(theme, '--font-sans')
    expect(value).toBe('var(--font-sans)')
  })

  it('--font-mono maps to var(--font-mono)', () => {
    const value = extractToken(theme, '--font-mono')
    expect(value).toBe('var(--font-mono)')
  })
})

describe('Design token — body and monospace rules', () => {
  it('body font-family uses var(--font-sans), not var(--font-inter)', () => {
    expect(css).toContain('font-family: var(--font-sans)')
    expect(css).not.toContain('var(--font-inter)')
  })

  it('code/pre/kbd/samp rule uses var(--font-mono)', () => {
    expect(css).toMatch(/code,\s*pre,\s*kbd,\s*samp\s*\{/)
    expect(css).toContain('font-family: var(--font-mono)')
  })
})
