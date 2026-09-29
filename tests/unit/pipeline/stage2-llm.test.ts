import { describe, it, expect, vi } from 'vitest'
import { runStage2Llm } from '@/lib/pipeline/stage2-llm'
import type { Stage2Opts } from '@/lib/pipeline/stage2-llm'
import type { NormalizedFinding } from '@/lib/scanners/types'
import type {
  ProviderClient,
  ProviderEvent,
  ToolCallEvent,
  ToolResultEvent,
  PermissionRequestEvent,
  CostEvent,
  ServerInfoEvent,
  FileReadEvent,
  FileWriteEvent,
  TerminalOutputEvent,
  PlanEvent,
} from '@/lib/providers/index'

function makeProvider(events: ProviderEvent[]): ProviderClient {
  return {
    id: 'mock:test',
    capability: {
      stream: true,
      tools: false,
      jsonMode: false,
      transportKind: 'acp' as const,
      thinkingSupport: false,
    },
    async *scan(): AsyncIterable<ProviderEvent> {
      for (const evt of events) {
        yield evt
      }
      yield { type: 'done' }
    },
  }
}

function makeOpts(overrides: Partial<Stage2Opts> = {}): Stage2Opts {
  return {
    scanId: 'test-scan',
    targetPath: '/tmp/test',
    provider: makeProvider([]),
    prompt: 'Test prompt',
    onEvent: () => {},
    ...overrides,
  }
}

describe('runStage2Llm', () => {
  it('stamps detector with detectorPrefix when provided', async () => {
    const findings: NormalizedFinding[] = []
    const provider = makeProvider([
      {
        type: 'finding',
        title: 'SQL Injection',
        description: 'Found SQL injection',
        severity: 'high',
        location: 'src/db.ts:10',
      },
    ])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
      detectorPrefix: 'llm:custom',
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].detector).toBe('llm:custom')
    expect(result.findings[0].title).toBe('SQL Injection')
  })

  it('stamps detector as default "llm" when no detectorPrefix is provided', async () => {
    const provider = makeProvider([
      {
        type: 'finding',
        title: 'XSS',
        description: 'XSS vulnerability',
        severity: 'medium',
        location: 'src/app.ts:42',
      },
    ])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].detector).toBe('llm')
  })

  it('adds domain tag to findings when domain is set', async () => {
    const provider = makeProvider([
      {
        type: 'finding',
        title: 'Auth Bypass',
        description: 'Session validation missing',
        severity: 'critical',
        location: 'src/auth.ts:5',
      },
    ])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
      domain: 'auth',
      detectorPrefix: 'llm:auth',
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].detector).toBe('llm:auth')
    expect(result.findings[0].tags).toContain('domain:auth')
  })

  it('does not add domain tag when domain is not set', async () => {
    const provider = makeProvider([
      {
        type: 'finding',
        title: 'Hardcoded Secret',
        description: 'API key in source',
        severity: 'high',
        location: 'src/config.ts:3',
      },
    ])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].tags).toBeUndefined()
  })

  it('returns empty findings and emits progress when provider yields no findings', async () => {
    const events: ScanEvent[] = []
    const provider = makeProvider([])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e as any),
    })

    expect(result.findings).toEqual([])
    expect(events.some((e) => e.type === 'progress' || e.type === 'stage')).toBe(true)
  })

  it('returns domain in result when domain is set', async () => {
    const provider = makeProvider([])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
      domain: 'input-validation',
    })

    expect(result.domain).toBe('input-validation')
  })

  it('does not return domain in result when domain is not set', async () => {
    const provider = makeProvider([])

    const result = await runStage2Llm({
      ...makeOpts({ provider }),
    })

    expect(result.domain).toBeUndefined()
  })

  it('emits stage start and complete events', async () => {
    const events: any[] = []
    const provider = makeProvider([])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const stageEvents = events.filter((e) => e.type === 'stage' && e.stage === 'llm-scan')
    expect(stageEvents).toHaveLength(2)
    expect(stageEvents[0].message).toContain('Starting')
    expect(stageEvents[1].message).toContain('complete')
  })

  it('forwards format field on thinking events from provider', async () => {
    const events: any[] = []
    const provider = makeProvider([
      { type: 'thinking', text: '## Analysis', format: 'markdown' },
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const thinking = events.filter((e: any) => e.type === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0].format).toBe('markdown')
    expect(thinking[0].text).toBe('## Analysis')
  })

  it('forwards plain format on thinking events', async () => {
    const events: any[] = []
    const provider = makeProvider([
      { type: 'thinking', text: 'plain reasoning', format: 'plain' },
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const thinking = events.filter((e: any) => e.type === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0].format).toBe('plain')
  })
})

// ─── New event type forwarding (Phase 3: Rich Event Taxonomy) ────────────────

describe('runStage2Llm — forwards tool_call events', () => {
  it('forwards tool_call as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'tool_call',
        toolName: 'read_file',
        toolCallId: 'tc_001',
        input: { path: '/src/app.ts' },
      } as ToolCallEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const toolCalls = events.filter((e) => e.type === 'tool_call')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].toolName).toBe('read_file')
    expect(toolCalls[0].toolCallId).toBe('tc_001')
    expect(toolCalls[0].input).toEqual({ path: '/src/app.ts' })
  })
})

describe('runStage2Llm — forwards tool_result events', () => {
  it('forwards successful tool_result as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'tool_result',
        toolCallId: 'tc_001',
        output: { content: 'file contents' },
        isError: false,
      } as ToolResultEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const results = events.filter((e) => e.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0].toolCallId).toBe('tc_001')
    expect(results[0].isError).toBe(false)
  })

  it('forwards error tool_result as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'tool_result',
        toolCallId: 'tc_err',
        output: 'Permission denied',
        isError: true,
      } as ToolResultEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const results = events.filter((e) => e.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0].isError).toBe(true)
  })
})

describe('runStage2Llm — forwards permission_request events', () => {
  it('forwards permission_request as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'permission_request',
        requestId: 'perm_001',
        toolName: 'write_file',
        input: { path: '/etc/hosts' },
        timeoutMs: 60000,
      } as PermissionRequestEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const perms = events.filter((e) => e.type === 'permission_request')
    expect(perms).toHaveLength(1)
    expect(perms[0].requestId).toBe('perm_001')
    expect(perms[0].toolName).toBe('write_file')
    expect(perms[0].timeoutMs).toBe(60000)
  })
})

describe('runStage2Llm — forwards cost events', () => {
  it('forwards cost event with all fields as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'cost',
        inputTokens: 1500,
        outputTokens: 800,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        costUsd: 0.015,
      } as CostEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const costs = events.filter((e) => e.type === 'cost')
    expect(costs).toHaveLength(1)
    expect(costs[0].inputTokens).toBe(1500)
    expect(costs[0].outputTokens).toBe(800)
    expect(costs[0].cacheReadTokens).toBe(200)
    expect(costs[0].costUsd).toBe(0.015)
  })

  it('forwards cost event with only required fields', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'cost',
        inputTokens: 100,
        outputTokens: 50,
      } as CostEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const costs = events.filter((e) => e.type === 'cost')
    expect(costs).toHaveLength(1)
    expect(costs[0].inputTokens).toBe(100)
    expect(costs[0].outputTokens).toBe(50)
    expect(costs[0].cacheReadTokens).toBeUndefined()
  })
})

describe('runStage2Llm — forwards server_info events', () => {
  it('forwards server_info as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'server_info',
        agentId: 'claude-code',
        agentVersion: '1.0.0',
        capabilities: { tools: true },
      } as ServerInfoEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const infos = events.filter((e) => e.type === 'server_info')
    expect(infos).toHaveLength(1)
    expect(infos[0].agentId).toBe('claude-code')
    expect(infos[0].agentVersion).toBe('1.0.0')
  })
})

describe('runStage2Llm — forwards file_read events', () => {
  it('forwards file_read as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'file_read',
        path: '/src/app.ts',
        preview: 'import React',
      } as FileReadEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const reads = events.filter((e) => e.type === 'file_read')
    expect(reads).toHaveLength(1)
    expect(reads[0].path).toBe('/src/app.ts')
    expect(reads[0].preview).toBe('import React')
  })
})

describe('runStage2Llm — forwards file_write events', () => {
  it('forwards file_write as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'file_write',
        path: '/src/new.ts',
        preview: 'export function hello()',
      } as FileWriteEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const writes = events.filter((e) => e.type === 'file_write')
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe('/src/new.ts')
    expect(writes[0].preview).toBe('export function hello()')
  })
})

describe('runStage2Llm — forwards terminal_output events', () => {
  it('forwards terminal_output with command as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'terminal_output',
        command: 'npm test',
        output: 'All tests passed!',
        exitCode: 0,
      } as TerminalOutputEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const terms = events.filter((e) => e.type === 'terminal_output')
    expect(terms).toHaveLength(1)
    expect(terms[0].command).toBe('npm test')
    expect(terms[0].output).toBe('All tests passed!')
    expect(terms[0].exitCode).toBe(0)
  })

  it('forwards terminal_output with error exit code', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'terminal_output',
        output: 'Build failed',
        exitCode: 1,
      } as TerminalOutputEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const terms = events.filter((e) => e.type === 'terminal_output')
    expect(terms).toHaveLength(1)
    expect(terms[0].exitCode).toBe(1)
  })
})

describe('runStage2Llm — forwards plan events', () => {
  it('forwards plan with multiple steps as ScanEvent', async () => {
    const events: any[] = []
    const provider = makeProvider([
      {
        type: 'plan',
        steps: [
          { title: 'Read codebase', status: 'done' },
          { title: 'Analyze patterns', status: 'in_progress' },
          { title: 'Report findings', status: 'pending' },
        ],
      } as PlanEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    const plans = events.filter((e) => e.type === 'plan')
    expect(plans).toHaveLength(1)
    expect(plans[0].steps).toHaveLength(3)
    expect(plans[0].steps[0]).toEqual({ title: 'Read codebase', status: 'done' })
    expect(plans[0].steps[1].status).toBe('in_progress')
  })
})

describe('runStage2Llm — all 9 new event types none dropped', () => {
  it('forwards one of each new event type without dropping any', async () => {
    const events: any[] = []
    const provider = makeProvider([
      { type: 'tool_call', toolName: 't', toolCallId: '1', input: null } as ProviderEvent,
      { type: 'tool_result', toolCallId: '1', output: null, isError: false } as ProviderEvent,
      { type: 'permission_request', requestId: 'r1', toolName: 't', input: null, timeoutMs: 60000 } as ProviderEvent,
      { type: 'cost', inputTokens: 10, outputTokens: 5 } as ProviderEvent,
      { type: 'server_info', agentId: 'test' } as ProviderEvent,
      { type: 'file_read', path: '/f.ts' } as ProviderEvent,
      { type: 'file_write', path: '/w.ts' } as ProviderEvent,
      { type: 'terminal_output', output: 'hello' } as ProviderEvent,
      { type: 'plan', steps: [{ title: 's1', status: 'pending' }] } as ProviderEvent,
    ])

    await runStage2Llm({
      ...makeOpts({ provider }),
      onEvent: (e) => events.push(e),
    })

    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'cost')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'server_info')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'file_read')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'file_write')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'terminal_output')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(1)
  })
})

// Needed for onEvent type
import type { ScanEvent } from '@/lib/pipeline/events'
