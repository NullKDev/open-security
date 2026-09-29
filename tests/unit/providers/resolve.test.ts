import { describe, it, expect, vi } from 'vitest'
import { resolveOnPath, probeAgent, getAgentDef } from '@/lib/providers/cli/resolve'
import type { AgentDef } from '@/lib/providers/cli/agents'

describe('resolveOnPath', () => {
  it('returns true when access checker succeeds', () => {
    const check = vi.fn(() => true)
    expect(resolveOnPath('claude', check)).toBe(true)
    expect(check).toHaveBeenCalledWith('claude')
  })

  it('returns false when access checker returns false', () => {
    const check = vi.fn(() => false)
    expect(resolveOnPath('nonexistent', check)).toBe(false)
    expect(check).toHaveBeenCalledWith('nonexistent')
  })
})

describe('getAgentDef', () => {
  it('returns claude agent definition with correct fields', () => {
    const def = getAgentDef('claude')
    expect(def).toBeDefined()
    expect(def!.id).toBe('claude')
    expect(def!.bin).toBe('claude')
    expect(def!.streamFormat).toBe('claude-stream-json')
    expect(def!.probeArgs).toEqual(['--version'])
    expect(typeof def!.buildArgs).toBe('function')
  })

  it('returns codex agent definition', () => {
    const def = getAgentDef('codex')
    expect(def).toBeDefined()
    expect(def!.id).toBe('codex')
    expect(def!.bin).toBe('codex')
    expect(def!.streamFormat).toBe('json-event-stream')
  })

  it('returns gemini agent definition', () => {
    const def = getAgentDef('gemini')
    expect(def).toBeDefined()
    expect(def!.id).toBe('gemini')
  })

  it('returns ollama agent definition with model-dependent buildArgs', () => {
    const def = getAgentDef('ollama')
    expect(def).toBeDefined()
    const args = def!.buildArgs('test prompt', {
      targetPath: '/tmp',
      modelId: 'codellama',
    })
    expect(args).toContain('codellama')
    expect(args).toContain('test prompt')
  })

  it('returns undefined for unknown agent', () => {
    const def = getAgentDef('unknown-agent-xyz')
    expect(def).toBeUndefined()
  })
})

describe('probeAgent', () => {
  it('returns true when binary exists and probe command succeeds', () => {
    const check = () => true
    const execFn = () => 'claude v1.0.0'

    const def: AgentDef = {
      id: 'claude',
      bin: 'claude',
      probeArgs: ['--version'],
      streamFormat: 'claude-stream-json',
      transport: 'sdk',
      buildArgs: () => [],
    }

    return expect(probeAgent(def, check, execFn)).resolves.toBe(true)
  })

  it('returns false when binary not found on PATH', () => {
    const check = () => false
    const execFn = vi.fn()

    const def: AgentDef = {
      id: 'claude',
      bin: 'claude',
      probeArgs: ['--version'],
      streamFormat: 'claude-stream-json',
      transport: 'sdk',
      buildArgs: () => [],
    }

    return expect(probeAgent(def, check, execFn)).resolves.toBe(false)
  })

  it('returns false when probe command fails (non-zero exit)', () => {
    const check = () => true
    const execFn = () => {
      throw new Error('Command failed with code 1')
    }

    const def: AgentDef = {
      id: 'claude',
      bin: 'claude',
      probeArgs: ['--version'],
      streamFormat: 'claude-stream-json',
      transport: 'sdk',
      buildArgs: () => [],
    }

    return expect(probeAgent(def, check, execFn)).resolves.toBe(false)
  })
})
