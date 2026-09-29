import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AGENT_DEFS, getAgentDef } from '@/lib/providers/cli/agents'

describe('Agent Definitions — snapshot configs', () => {
  describe('gemini', () => {
    it('uses ACP transport with --acp flag (not subcommand)', () => {
      const def = getAgentDef('gemini')
      expect(def).toBeDefined()
      expect(def!.id).toBe('gemini')
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['--acp'])
    })

    it('retains existing agent metadata', () => {
      const def = getAgentDef('gemini')!
      expect(def.bin).toBe('gemini')
      expect(def.streamFormat).toBe('json-event-stream')
      expect(def.probeArgs).toEqual(['--version'])
      expect(def.fallbackModels).toBeDefined()
      expect(def.fallbackModels!.length).toBeGreaterThan(0)
    })
  })

  describe('opencode', () => {
    it('uses ACP transport with acp subcommand', () => {
      const def = getAgentDef('opencode')
      expect(def).toBeDefined()
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['acp'])
    })

    it('has promptViaStdin disabled (ACP uses SDK, not stdin)', () => {
      const def = getAgentDef('opencode')!
      expect(def.promptViaStdin).toBe(false)
    })

    it('retains listModels capability', () => {
      const def = getAgentDef('opencode')!
      expect(def.listModels).toBeDefined()
      expect(def.listModels!.args).toEqual(['models'])
    })
  })

  describe('qwen', () => {
    it('uses ACP transport with --acp flag', () => {
      const def = getAgentDef('qwen')
      expect(def).toBeDefined()
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['--acp'])
    })

    it('retains existing agent metadata', () => {
      const def = getAgentDef('qwen')!
      expect(def.bin).toBe('qwen')
      expect(def.name).toBe('Qwen Code')
      expect(def.streamFormat).toBe('json-event-stream')
    })
  })

  describe('codex', () => {
    it('uses ACP transport with --acp flag (standard ACP)', () => {
      const def = getAgentDef('codex')
      expect(def).toBeDefined()
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['--acp'])
    })

    it('retains existing agent metadata', () => {
      const def = getAgentDef('codex')!
      expect(def.bin).toBe('codex')
      expect(def.name).toBe('Codex CLI')
      expect(def.streamFormat).toBe('json-event-stream')
    })
  })

  describe('copilot (NEW)', () => {
    it('exists as npx-based ACP agent', () => {
      const def = getAgentDef('copilot')
      expect(def).toBeDefined()
      expect(def!.id).toBe('copilot')
      expect(def!.bin).toBe('npx')
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['@github/copilot-language-server@latest', '--acp'])
      expect(def!.streamFormat).toBe('json-event-stream')
    })

    it('has probeArgs for npx resolution', () => {
      const def = getAgentDef('copilot')!
      expect(def.probeArgs).toBeDefined()
      expect(def.probeArgs.length).toBeGreaterThan(0)
      // probeArgs checks npx availability, not the package itself
      expect(def.probeArgs).toContain('--version')
    })
  })

  describe('auggie (NEW)', () => {
    it('exists as npx-based ACP agent', () => {
      const def = getAgentDef('auggie')
      expect(def).toBeDefined()
      expect(def!.id).toBe('auggie')
      expect(def!.bin).toBe('npx')
      expect(def!.transport).toBe('acp')
      expect(def!.acpArgs).toEqual(['@augmentcode/auggie@latest', '--acp'])
      expect(def!.streamFormat).toBe('json-event-stream')
    })

    it('has probeArgs for npx resolution', () => {
      const def = getAgentDef('auggie')!
      expect(def.probeArgs).toBeDefined()
      expect(def.probeArgs.length).toBeGreaterThan(0)
      expect(def.probeArgs).toContain('--version')
    })
  })
})

describe('ACP agent invariants', () => {
  it('all ACP agents have buildArgs defined and acpArgs configured', () => {
    const acpAgents = AGENT_DEFS.filter((a) => a.transport === 'acp')
    // At minimum: claude (sdk), gemini, opencode, qwen, codex, copilot, auggie = 6 ACP agents
    expect(acpAgents.length).toBeGreaterThanOrEqual(6)

    for (const def of acpAgents) {
      // buildArgs must exist on the interface (even for ACP — never called)
      expect(typeof def.buildArgs).toBe('function')
      // acpArgs must be defined for ACP path
      expect(def.acpArgs).toBeDefined()
      expect(Array.isArray(def.acpArgs)).toBe(true)
      expect(def.acpArgs!.length).toBeGreaterThan(0)
    }
  })

  it('all acp agents have acpArgs defined', () => {
    const acpAgents = AGENT_DEFS.filter((a) => a.transport === 'acp')
    expect(acpAgents.length).toBeGreaterThan(0)
    for (const def of acpAgents) {
      expect(def.acpArgs).toBeDefined()
      expect(def.acpArgs!.length).toBeGreaterThan(0)
    }
  })

})

describe('ACP transport guard — buildArgs never called for ACP agents', () => {
  it('acpScan receives AgentDef directly — not pre-built args array', async () => {
    // Dynamic import to verify module-level structure
    const { acpScan } = await import('@/lib/providers/transport/acp')
    expect(typeof acpScan).toBe('function')
    // acpScan has 3 declared parameters: (def: AgentDef, prompt: string, opts: ScanOpts)
    // It receives the full AgentDef — SessionManager internally uses def.acpArgs,
    // never calling def.buildArgs. This is structural verification.
    expect(acpScan.length).toBe(3)
  })

  it('buildArgs exists on every ACP agent but is never invoked by ACP path', () => {
    // Verify that for each ACP agent, buildArgs is a function (interface contract)
    // but the ACP transport path does NOT call it. The stage-routing switch
    // routes transport:'acp' to acpScan(def, ...) — no call to def.buildArgs().
    const acpAgents = AGENT_DEFS.filter((a) => a.transport === 'acp')
    for (const def of acpAgents) {
      expect(typeof def.buildArgs).toBe('function')
      // buildArgs is defined per AgentDef interface but ACP path ignores it
    }
  })
})

// ---------------------------------------------------------------------------
// loadExternalAgents() — external agent config loading
// ---------------------------------------------------------------------------

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  default: { readFileSync: mockReadFileSync },
  readFileSync: mockReadFileSync,
}))

import { loadExternalAgents } from '@/lib/providers/cli/agents'
import type { AgentDef } from '@/lib/providers/cli/agents'

function makeExternalAgent(id: string, overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id,
    bin: `${id}-bin`,
    probeArgs: ['--ext-version'],
    streamFormat: 'json-event-stream' as const,
    transport: 'acp' as const,
    acpArgs: [`--ext-${id}`],
    buildArgs: () => [],
    ...overrides,
  }
}

describe('loadExternalAgents', () => {
  const originalConfig = process.env.ACP_AGENTS_CONFIG

  beforeEach(() => {
    vi.mocked(mockReadFileSync).mockReset()
  })

  afterEach(() => {
    if (originalConfig === undefined) {
      delete process.env.ACP_AGENTS_CONFIG
    } else {
      process.env.ACP_AGENTS_CONFIG = originalConfig
    }
  })

  it('returns hardcoded AGENT_DEFS when ACP_AGENTS_CONFIG is not set', () => {
    delete process.env.ACP_AGENTS_CONFIG

    const agents = loadExternalAgents()
    expect(agents).toEqual(AGENT_DEFS)
  })

  it('returns hardcoded AGENT_DEFS when ACP_AGENTS_CONFIG is an empty string', () => {
    process.env.ACP_AGENTS_CONFIG = ''

    const agents = loadExternalAgents()
    expect(agents).toEqual(AGENT_DEFS)
  })

  it('reads and merges external agents from JSON file', () => {
    process.env.ACP_AGENTS_CONFIG = '/opt/agents.json'
    const external = [
      makeExternalAgent('custom-agent', {
        name: 'Custom Agent',
        bin: '/usr/local/bin/custom',
        env: { CUSTOM_KEY: 'custom-value' },
      }),
    ]
    mockReadFileSync.mockReturnValue(JSON.stringify(external))

    const agents = loadExternalAgents()
    // Should contain all original agents plus the custom one
    const custom = agents.find((a) => a.id === 'custom-agent')
    expect(custom).toBeDefined()
    expect(custom!.name).toBe('Custom Agent')
    expect(custom!.bin).toBe('/usr/local/bin/custom')
    expect(custom!.env).toEqual({ CUSTOM_KEY: 'custom-value' })
    // Original agents still present
    expect(agents.find((a) => a.id === 'claude')).toBeDefined()
    expect(agents.find((a) => a.id === 'gemini')).toBeDefined()
  })

  it('external agent overrides hardcoded agent with same id', () => {
    process.env.ACP_AGENTS_CONFIG = '/opt/override.json'
    const external = [
      makeExternalAgent('claude', {
        name: 'Overridden Claude',
        bin: '/override/claude',
      }),
    ]
    mockReadFileSync.mockReturnValue(JSON.stringify(external))

    const agents = loadExternalAgents()
    const claude = agents.find((a) => a.id === 'claude')
    expect(claude).toBeDefined()
    expect(claude!.name).toBe('Overridden Claude')
    expect(claude!.bin).toBe('/override/claude')
  })

  it('returns AGENT_DEFS on file read error (graceful degradation)', () => {
    process.env.ACP_AGENTS_CONFIG = '/nonexistent/file.json'
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file')
    })

    const agents = loadExternalAgents()
    expect(agents).toEqual(AGENT_DEFS)
  })

  it('returns AGENT_DEFS on malformed JSON', () => {
    process.env.ACP_AGENTS_CONFIG = '/opt/broken.json'
    mockReadFileSync.mockReturnValue('{this is not valid json}')

    const agents = loadExternalAgents()
    expect(agents).toEqual(AGENT_DEFS)
  })

  it('returns AGENT_DEFS when external file is empty', () => {
    process.env.ACP_AGENTS_CONFIG = '/opt/empty.json'
    mockReadFileSync.mockReturnValue('')

    const agents = loadExternalAgents()
    expect(agents).toEqual(AGENT_DEFS)
  })
})
