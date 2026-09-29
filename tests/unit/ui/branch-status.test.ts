import { describe, it, expect } from 'vitest'
import {
  isTerminalBranchStatus,
  branchStatusLabel,
  branchStatusColor,
} from '@/lib/ui/branch-status'

describe('isTerminalBranchStatus', () => {
  it('returns false for pending', () => {
    expect(isTerminalBranchStatus('pending')).toBe(false)
  })

  it('returns false for creating', () => {
    expect(isTerminalBranchStatus('creating')).toBe(false)
  })

  it('returns false for tests_running', () => {
    expect(isTerminalBranchStatus('tests_running')).toBe(false)
  })

  it('returns true for created', () => {
    expect(isTerminalBranchStatus('created')).toBe(true)
  })

  it('returns true for apply_failed', () => {
    expect(isTerminalBranchStatus('apply_failed')).toBe(true)
  })

  it('returns true for tests_failed', () => {
    expect(isTerminalBranchStatus('tests_failed')).toBe(true)
  })
})

describe('branchStatusLabel', () => {
  it('returns "Pending" for pending', () => {
    expect(branchStatusLabel('pending')).toBe('Pending')
  })

  it('returns "Creating branch…" for creating', () => {
    expect(branchStatusLabel('creating')).toBe('Creating branch…')
  })

  it('returns "Running tests…" for tests_running', () => {
    expect(branchStatusLabel('tests_running')).toBe('Running tests…')
  })

  it('returns "Branch created" for created', () => {
    expect(branchStatusLabel('created')).toBe('Branch created')
  })

  it('returns "Apply failed" for apply_failed', () => {
    expect(branchStatusLabel('apply_failed')).toBe('Apply failed')
  })

  it('returns "Tests failed" for tests_failed', () => {
    expect(branchStatusLabel('tests_failed')).toBe('Tests failed')
  })
})

describe('branchStatusColor', () => {
  it('returns success color for created', () => {
    expect(branchStatusColor('created')).toContain('green')
  })

  it('returns error color for apply_failed', () => {
    expect(branchStatusColor('apply_failed')).toContain('red')
  })

  it('returns error color for tests_failed', () => {
    expect(branchStatusColor('tests_failed')).toContain('red')
  })

  it('returns neutral color for pending', () => {
    const color = branchStatusColor('pending')
    expect(color).toBeTruthy()
  })

  it('returns active color for creating', () => {
    const color = branchStatusColor('creating')
    expect(color).toBeTruthy()
  })

  it('returns active color for tests_running', () => {
    const color = branchStatusColor('tests_running')
    expect(color).toBeTruthy()
  })
})
