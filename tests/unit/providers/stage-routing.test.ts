import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveModelString,
  createProviderForStage,
  buildScanPrompt,
} from '@/lib/providers/stage-routing'
import { getAgentDef } from '@/lib/providers/cli/agents'
import type { StageId } from '@/lib/config/schema'
import type { BuildScanPromptOpts } from '@/lib/providers/stage-routing'

// Mock the config store
vi.mock('@/lib/config/store', () => ({
  readConfig: vi.fn(),
  OBT_ROOT: '/tmp/.obt-test',
  OBT_CONFIG_PATH: '/tmp/.obt-test/config.json',
  OBT_DB_PATH: '/tmp/.obt-test/db.sqlite',
}))

import { readConfig } from '@/lib/config/store'

describe('resolveModelString', () => {
  it('parses cli:claude → cli provider with claude agent', () => {
    const result = resolveModelString('cli:claude')!
    expect(result.kind).toBe('cli')
    if (result.kind === 'cli') {
      expect(result.agentId).toBe('claude')
    }
  })

  it('parses cli:codex → cli provider with codex agent', () => {
    const result = resolveModelString('cli:codex')!
    expect(result.kind).toBe('cli')
    if (result.kind === 'cli') {
      expect(result.agentId).toBe('codex')
    }
  })

  it('parses api:anthropic:claude-sonnet-4 → api provider with model', () => {
    const result = resolveModelString('api:anthropic:claude-sonnet-4')!
    expect(result.kind).toBe('api')
    if (result.kind === 'api') {
      expect(result.providerId).toBe('anthropic')
      expect(result.modelId).toBe('claude-sonnet-4')
    }
  })

  it('parses api:openai:gpt-4o → api provider with model', () => {
    const result = resolveModelString('api:openai:gpt-4o')!
    expect(result.kind).toBe('api')
    if (result.kind === 'api') {
      expect(result.providerId).toBe('openai')
      expect(result.modelId).toBe('gpt-4o')
    }
  })

  it('parses api:google:gemini-2.5-pro → api provider', () => {
    const result = resolveModelString('api:google:gemini-2.5-pro')!
    expect(result.kind).toBe('api')
    if (result.kind === 'api') {
      expect(result.providerId).toBe('google')
      expect(result.modelId).toBe('gemini-2.5-pro')
    }
  })

  it('parses api:ollama:llama3 → api provider (ollama)', () => {
    const result = resolveModelString('api:ollama:llama3')!
    expect(result.kind).toBe('api')
    if (result.kind === 'api') {
      expect(result.providerId).toBe('ollama')
      expect(result.modelId).toBe('llama3')
    }
  })

  it('returns undefined for unrecognized prefix', () => {
    const result = resolveModelString('unknown:something')
    expect(result).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    const result = resolveModelString('')
    expect(result).toBeUndefined()
  })
})

describe('createProviderForStage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a CLI ProviderClient for cli:claude config', () => {
    vi.mocked(readConfig).mockReturnValue({
      models: { 'llm-scan': 'cli:claude' },
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    } as any)

    const provider = createProviderForStage('llm-scan')
    expect(provider).toBeDefined()
    expect(provider!.id).toBe('cli:claude')
    expect(provider!.capability.stream).toBe(true)
    expect(provider!.capability.tools).toBe(true)
  })

  it('returns an API ProviderClient for api:anthropic:sonnet config', () => {
    vi.mocked(readConfig).mockReturnValue({
      models: { 'llm-scan': 'api:anthropic:claude-sonnet-4' },
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    } as any)

    const provider = createProviderForStage('llm-scan')
    expect(provider).toBeDefined()
    expect(provider!.id).toBe('api:anthropic:claude-sonnet-4')
    expect(provider!.capability.stream).toBe(true)
    expect(provider!.capability.tools).toBe(true)
  })

  it('returns undefined for unconfigured stage', () => {
    vi.mocked(readConfig).mockReturnValue({
      models: {},
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    } as any)

    const provider = createProviderForStage('llm-scan')
    expect(provider).toBeUndefined()
  })

  it('returns undefined for invalid model string in config', () => {
    vi.mocked(readConfig).mockReturnValue({
      models: { 'llm-scan': 'invalid' },
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    } as any)

    const provider = createProviderForStage('llm-scan')
    expect(provider).toBeUndefined()
  })

  it('works for validate stage with different provider', () => {
    vi.mocked(readConfig).mockReturnValue({
      models: { validate: 'cli:gemini' },
      providers: {},
      theme: 'dark',
      workerMemoryMb: 2048,
      stage2Concurrency: 4,
    } as any)

    const provider = createProviderForStage('validate')
    expect(provider).toBeDefined()
    expect(provider!.id).toBe('cli:gemini')
  })
})

describe('TransportKind routing — agent transport assignments', () => {
  it('claude uses sdk transport', () => {
    expect(getAgentDef('claude')?.transport).toBe('sdk')
  })

  it('ollama uses http transport', () => {
    expect(getAgentDef('ollama')?.transport).toBe('http')
  })

  it('gemini uses acp transport', () => {
    expect(getAgentDef('gemini')?.transport).toBe('acp')
  })

  it('codex uses acp transport', () => {
    expect(getAgentDef('codex')?.transport).toBe('acp')
  })

  it('opencode uses acp transport', () => {
    expect(getAgentDef('opencode')?.transport).toBe('acp')
  })

  it('cursor-agent uses acp transport', () => {
    expect(getAgentDef('cursor-agent')?.transport).toBe('acp')
  })

  it('qwen uses acp transport', () => {
    expect(getAgentDef('qwen')?.transport).toBe('acp')
  })

  it('qwen buildArgs includes --output-format json', () => {
    const def = getAgentDef('qwen')!
    const args = def.buildArgs('prompt', { targetPath: '/tmp' })
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
  })

  it('gemini and codex have acpArgs configured', () => {
    expect(getAgentDef('gemini')?.acpArgs).toBeDefined()
    expect(getAgentDef('codex')?.acpArgs).toBeDefined()
  })
})

describe('buildScanPrompt', () => {
  it('returns a valid non-empty prompt string with minimal opts', () => {
    const prompt = buildScanPrompt({ stack: [] })
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('security code reviewer')
    expect(prompt).toContain('SQL injection')
  })

  it('includes stack references in the prompt', () => {
    const prompt = buildScanPrompt({
      stack: ['react', 'typescript'],
    })
    expect(prompt).toContain('security code reviewer')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('includes userPrompt when provided', () => {
    const prompt = buildScanPrompt({
      stack: [],
      userPrompt: 'Check for OWASP Top 10 vulnerabilities',
    })
    expect(prompt).toContain('Check for OWASP Top 10 vulnerabilities')
  })

  it('produces valid output with domain set', () => {
    const prompt = buildScanPrompt({
      stack: ['react'],
      domain: 'auth',
    })
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(50)
  })

  it('includes ## Security Skills section when rule fixture is provided', () => {
    const fixture = `## Compact Rules

### next-js-security
**Triggers**: next.js, typescript
**Source**: skills/next-best-practices

Always validate session tokens on every API route.
Prefer server components over client components for data fetching.`

    const prompt = buildScanPrompt({
      stack: ['next.js', 'typescript'],
      domain: 'auth',
      registryMarkdown: fixture,
    } as BuildScanPromptOpts & { registryMarkdown?: string })
    expect(prompt).toContain('## Security Skills')
    expect(prompt).toContain('validate session tokens')
  })

  it('returns a valid prompt even with empty registry', () => {
    const prompt = buildScanPrompt({
      stack: ['go'],
      registryMarkdown: '## Compact Rules\n',
    } as BuildScanPromptOpts & { registryMarkdown?: string })
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('security code reviewer')
  })

  it('includes files list when provided', () => {
    const prompt = buildScanPrompt({
      stack: ['python'],
      files: ['src/auth.py', 'src/db.py'],
    })
    expect(prompt).toContain('src/auth.py')
    expect(prompt).toContain('src/db.py')
  })

  it('includes fix suggestion instruction when includeFixSuggestions is true', () => {
    const prompt = buildScanPrompt({
      stack: ['react'],
      includeFixSuggestions: true,
    })
    expect(prompt).toContain('fix')
    expect(prompt).toContain('patch')
  })
})
