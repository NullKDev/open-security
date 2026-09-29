import { describe, it, expect } from 'vitest'
import {
  formatAge,
  formatEpss,
  severityColorClass,
  severityLabel,
} from '@/lib/ui/queue-formatters'

describe('formatAge', () => {
  it('returns "today" for dates less than 1 day ago', () => {
    const now = new Date()
    expect(formatAge(now.toISOString())).toBe('today')
  })

  it('returns "1 day ago" for dates exactly 1 day old', () => {
    const d = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    expect(formatAge(d.toISOString())).toBe('1 day ago')
  })

  it('returns "N days ago" for dates older than 1 day', () => {
    const d = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    expect(formatAge(d.toISOString())).toBe('5 days ago')
  })

  it('returns "unknown" for null', () => {
    expect(formatAge(null)).toBe('unknown')
  })

  it('returns "unknown" for undefined', () => {
    expect(formatAge(undefined)).toBe('unknown')
  })
})

describe('formatEpss', () => {
  it('formats EPSS score as percentage string', () => {
    expect(formatEpss(0.73)).toBe('73.00%')
  })

  it('formats low EPSS scores correctly', () => {
    expect(formatEpss(0.01)).toBe('1.00%')
  })

  it('formats 1.0 as 100%', () => {
    expect(formatEpss(1.0)).toBe('100.00%')
  })

  it('returns "N/A" for null', () => {
    expect(formatEpss(null)).toBe('N/A')
  })

  it('returns "N/A" for undefined', () => {
    expect(formatEpss(undefined)).toBe('N/A')
  })

  it('formats small fraction correctly', () => {
    expect(formatEpss(0.0042)).toBe('0.42%')
  })
})

describe('severityColorClass', () => {
  it('returns red class for critical', () => {
    expect(severityColorClass('critical')).toContain('red')
  })

  it('returns orange class for high', () => {
    expect(severityColorClass('high')).toContain('orange')
  })

  it('returns yellow class for medium', () => {
    expect(severityColorClass('medium')).toContain('yellow')
  })

  it('returns blue class for low', () => {
    expect(severityColorClass('low')).toContain('blue')
  })

  it('returns gray class for info', () => {
    expect(severityColorClass('info')).toContain('gray')
  })

  it('returns gray for unknown severity', () => {
    expect(severityColorClass('unknown')).toContain('gray')
  })
})

describe('severityLabel', () => {
  it('capitalizes critical', () => {
    expect(severityLabel('critical')).toBe('Critical')
  })

  it('capitalizes high', () => {
    expect(severityLabel('high')).toBe('High')
  })

  it('capitalizes medium', () => {
    expect(severityLabel('medium')).toBe('Medium')
  })

  it('capitalizes low', () => {
    expect(severityLabel('low')).toBe('Low')
  })

  it('capitalizes info', () => {
    expect(severityLabel('info')).toBe('Info')
  })

  it('handles empty string gracefully', () => {
    expect(severityLabel('')).toBe('')
  })
})
