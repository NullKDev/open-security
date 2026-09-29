import { describe, it, expect } from 'vitest'
import { textLineToEvent, VALID_SEVERITIES } from '@/lib/providers/shared/line-parser'
import type { ProviderEvent } from '@/lib/providers/index'

// ─── VALID_SEVERITIES ──────────────────────────────────────────────────────

describe('VALID_SEVERITIES', () => {
  it('contains all five standard severity levels', () => {
    expect(VALID_SEVERITIES.has('critical')).toBe(true)
    expect(VALID_SEVERITIES.has('high')).toBe(true)
    expect(VALID_SEVERITIES.has('medium')).toBe(true)
    expect(VALID_SEVERITIES.has('low')).toBe(true)
    expect(VALID_SEVERITIES.has('info')).toBe(true)
  })

  it('rejects invalid severity labels', () => {
    expect(VALID_SEVERITIES.has('blocker')).toBe(false)
    expect(VALID_SEVERITIES.has('warning')).toBe(false)
    expect(VALID_SEVERITIES.has('')).toBe(false)
  })
})

// ─── Finding detection ─────────────────────────────────────────────────────

describe('textLineToEvent — finding detection', () => {
  it('classifies a valid 4-field JSON object as a finding', () => {
    const line = JSON.stringify({
      title: 'SQL Injection',
      description: 'Unsanitized input in query',
      severity: 'high',
      location: 'app/db.ts:42',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('finding')
    if (event.type === 'finding') {
      expect(event.title).toBe('SQL Injection')
      expect(event.description).toBe('Unsanitized input in query')
      expect(event.severity).toBe('high')
      expect(event.location).toBe('app/db.ts:42')
    }
  })

  it('preserves optional detector field when present', () => {
    const line = JSON.stringify({
      title: 'XSS',
      description: 'Unescaped output',
      severity: 'medium',
      location: 'app/view.ts:10',
      detector: 'llm',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('finding')
    if (event.type === 'finding') {
      expect(event.detector).toBe('llm')
    }
  })

  it('handles finding with severity "info"', () => {
    const line = JSON.stringify({
      title: 'Minor issue',
      description: 'Some description',
      severity: 'info',
      location: 'src/config.ts:5',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('finding')
  })
})

// ─── False-positive rejection ──────────────────────────────────────────────

describe('textLineToEvent — false-positive rejection', () => {
  it('rejects finding with location "N/A" → response', () => {
    const line = JSON.stringify({
      title: 'Some finding',
      description: 'Some description',
      severity: 'high',
      location: 'N/A',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('rejects finding with location "none" → response', () => {
    const line = JSON.stringify({
      title: 'Some finding',
      description: 'Some description',
      severity: 'high',
      location: 'none',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('rejects finding with location "N/A:1" → response', () => {
    const line = JSON.stringify({
      title: 'Some finding',
      description: 'Some description',
      severity: 'high',
      location: 'N/A:1',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('rejects finding with title "no vulnerabilities found" → response', () => {
    const line = JSON.stringify({
      title: 'No vulnerabilities found in the codebase',
      description: 'After thorough analysis, no security issues were identified',
      severity: 'info',
      location: 'src/app.ts:1',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('rejects finding with location "unknown" → response', () => {
    const line = JSON.stringify({
      title: 'Some finding',
      description: 'Some description',
      severity: 'medium',
      location: 'unknown',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('rejects finding missing severity field → response', () => {
    const line = JSON.stringify({
      title: 'X',
      description: 'Y',
      location: 'file.ts:1',
    })
    const event = textLineToEvent(line)
    expect(event.type).not.toBe('finding')
  })

  it('rejects finding missing location field → response', () => {
    const line = JSON.stringify({
      title: 'X',
      description: 'Y',
      severity: 'high',
    })
    const event = textLineToEvent(line)
    expect(event.type).not.toBe('finding')
  })

  it('rejects finding with invalid severity → response', () => {
    const line = JSON.stringify({
      title: 'X',
      description: 'Y',
      severity: 'blocker',
      location: 'f.ts:1',
    })
    const event = textLineToEvent(line)
    expect(event.type).not.toBe('finding')
  })
})

// ─── Response classification ───────────────────────────────────────────────

describe('textLineToEvent — response classification', () => {
  it('classifies plain text prose as response (NOT thinking)', () => {
    const line = 'The codebase appears well-structured.'
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
    if (event.type === 'response') {
      expect(event.text).toBe('The codebase appears well-structured.')
      // Default format is 'plain' per spec
      expect(event.format).toBe('plain')
    }
  })

  it('classifies markdown text as response with format preserved', () => {
    const line = '## Analysis\n\n**Key findings** below.'
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
    if (event.type === 'response') {
      expect(event.text).toBe('## Analysis\n\n**Key findings** below.')
    }
  })

  it('classifies multi-sentence LLM commentary as response', () => {
    const line = 'I analyzed the file structure. The project uses Express with TypeScript.'
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
    if (event.type === 'response') {
      expect(event.text).toBe(line)
    }
  })

  it('classifies non-JSON line starting with { but not valid JSON as response', () => {
    const line = '{not valid json at all'
    const event = textLineToEvent(line)
    expect(event.type).toBe('response')
  })

  it('classifies empty string (when trimmed non-empty) safely', () => {
    // textLineToEvent should never be called with empty string
    // (callers filter empty lines), but test robustness
    const event = textLineToEvent(' ')
    expect(event.type).toBe('response')
    if (event.type === 'response') {
      expect(event.text).toBe(' ')
    }
  })
})

// ─── Tool call → progress ──────────────────────────────────────────────────

describe('textLineToEvent — tool calls → progress', () => {
  it('classifies [tool] prefix as progress event', () => {
    const event = textLineToEvent('[tool] read')
    expect(event.type).toBe('progress')
    if (event.type === 'progress') {
      expect(event.message).toBe('[tool] read')
    }
  })

  it('classifies [tool] with extended name as progress', () => {
    const event = textLineToEvent('[tool] glob')
    expect(event.type).toBe('progress')
    if (event.type === 'progress') {
      expect(event.message).toBe('[tool] glob')
    }
  })
})

// ─── Edge cases ────────────────────────────────────────────────────────────

describe('textLineToEvent — edge cases', () => {
  it('handles a JSON object that looks like a finding but has empty title', () => {
    const line = JSON.stringify({
      title: '',
      description: 'Some description',
      severity: 'high',
      location: 'file.ts:1',
    })
    const event = textLineToEvent(line)
    expect(event.type).not.toBe('finding')
  })

  it('handles a JSON object with all required fields that looks valid', () => {
    const line = JSON.stringify({
      title: 'Hardcoded secret',
      description: 'Found API key in source',
      severity: 'critical',
      location: 'config/secrets.ts:4',
      detector: 'gitleaks',
    })
    const event = textLineToEvent(line)
    expect(event.type).toBe('finding')
  })

  it('does not crash on extremely long input', () => {
    const longText = 'A'.repeat(10000)
    const event = textLineToEvent(longText)
    expect(event.type).toBe('response')
    if (event.type === 'response') {
      expect(event.text).toBe(longText)
    }
  })
})
