import { describe, it, expect } from 'vitest'
import {
  scanEventSchema,
  isHighPriorityEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type PermissionRequestEvent,
  type CostEvent,
  type ServerInfoEvent,
  type FileReadEvent,
  type FileWriteEvent,
  type TerminalOutputEvent,
  type PlanEvent,
} from '@/lib/pipeline/events'

const baseFinding = {
  title: 'SQL Injection',
  description: 'User input flows into SQL',
  severity: 'high' as const,
  locationPath: 'src/db.ts',
  locationLineStart: 42,
  detector: 'llm',
}

describe('scanEventSchema — finding event', () => {
  it('parses a finding event without tags', () => {
    const event = {
      type: 'finding',
      finding: baseFinding,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('finding')
  })

  it('parses a finding event with tags', () => {
    const event = {
      type: 'finding',
      finding: { ...baseFinding, tags: ['domain:auth', 'domain:input'] },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('finding')
    if (parsed.type === 'finding') {
      expect(parsed.finding.tags).toEqual(['domain:auth', 'domain:input'])
    }
  })

  it('tags field is optional — omitting it still passes', () => {
    const event = { type: 'finding', finding: baseFinding }
    expect(() => scanEventSchema.parse(event)).not.toThrow()
  })
})

// ─── thinking event format ──────────────────────────────────────────────────

describe('scanEventSchema — thinking event format', () => {
  it('parses thinking event with format: markdown', () => {
    const event = {
      type: 'thinking',
      text: '## Analysis\n\n```python\nprint("hello")\n```',
      format: 'markdown',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('thinking')
    if (parsed.type === 'thinking') {
      expect(parsed.format).toBe('markdown')
    }
  })

  it('parses thinking event with format: plain', () => {
    const event = {
      type: 'thinking',
      text: 'Analyzing source files...',
      format: 'plain',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('thinking')
    if (parsed.type === 'thinking') {
      expect(parsed.format).toBe('plain')
    }
  })

  it('defaults format to plain when field is absent (backward compat)', () => {
    const event = {
      type: 'thinking',
      text: 'legacy thinking text',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('thinking')
    if (parsed.type === 'thinking') {
      expect(parsed.format).toBe('plain')
    }
  })
})

// ─── response event ─────────────────────────────────────────────────────────

describe('scanEventSchema — response event', () => {
  it('parses response event with format: plain', () => {
    const event = {
      type: 'response',
      text: 'The codebase is well-structured.',
      format: 'plain',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('response')
    if (parsed.type === 'response') {
      expect(parsed.type).toBe('response')
      expect(parsed.text).toBe('The codebase is well-structured.')
      expect(parsed.format).toBe('plain')
    }
  })

  it('parses response event with format: markdown', () => {
    const event = {
      type: 'response',
      text: '## Results\n\nAll clear.',
      format: 'markdown',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('response')
    if (parsed.type === 'response') {
      expect(parsed.format).toBe('markdown')
    }
  })

  it('defaults format to plain when absent', () => {
    const event = {
      type: 'response',
      text: 'No format specified',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('response')
    if (parsed.type === 'response') {
      expect(parsed.format).toBe('plain')
    }
  })
})

// ─── meta event ─────────────────────────────────────────────────────────────

describe('scanEventSchema — meta event', () => {
  it('parses meta event with transport_kind and thinkingSupport', () => {
    const event = {
      type: 'meta',
      providerId: 'cli:claude',
      transport_kind: 'sdk',
      thinkingSupport: true,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('meta')
    if (parsed.type === 'meta') {
      expect(parsed.providerId).toBe('cli:claude')
      expect(parsed.transport_kind).toBe('sdk')
      expect(parsed.thinkingSupport).toBe(true)
    }
  })

  it('parses meta event with thinkingSupport: false', () => {
    const event = {
      type: 'meta',
      providerId: 'api:ollama:llama3',
      transport_kind: 'api-sdk',
      thinkingSupport: false,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('meta')
    if (parsed.type === 'meta') {
      expect(parsed.thinkingSupport).toBe(false)
    }
  })
})

// ─── tool_call event ───────────────────────────────────────────────────────

describe('scanEventSchema — tool_call event', () => {
  it('parses a tool_call event with string input', () => {
    const event = {
      type: 'tool_call',
      toolName: 'read_file',
      toolCallId: 'tc_abc123',
      input: { path: '/src/app.ts' },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_call')
    if (parsed.type === 'tool_call') {
      expect(parsed.toolName).toBe('read_file')
      expect(parsed.toolCallId).toBe('tc_abc123')
      expect(parsed.input).toEqual({ path: '/src/app.ts' })
    }
  })

  it('parses a tool_call event with complex input', () => {
    const event = {
      type: 'tool_call',
      toolName: 'execute_command',
      toolCallId: 'tc_def456',
      input: { command: 'npm audit', args: ['--json'] },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_call')
    if (parsed.type === 'tool_call') {
      expect(parsed.toolName).toBe('execute_command')
      expect(parsed.input).toEqual({ command: 'npm audit', args: ['--json'] })
    }
  })

  it('rejects tool_call without toolName', () => {
    const event = {
      type: 'tool_call',
      toolCallId: 'tc_xyz',
      input: {},
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects tool_call without toolCallId', () => {
    const event = {
      type: 'tool_call',
      toolName: 'test',
      input: {},
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── tool_result event ──────────────────────────────────────────────────────

describe('scanEventSchema — tool_result event', () => {
  it('parses a successful tool_result', () => {
    const event = {
      type: 'tool_result',
      toolCallId: 'tc_abc123',
      output: { content: 'file contents here' },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_result')
    if (parsed.type === 'tool_result') {
      expect(parsed.toolCallId).toBe('tc_abc123')
      expect(parsed.output).toEqual({ content: 'file contents here' })
      expect(parsed.isError).toBe(false)
    }
  })

  it('parses a tool_result with isError: true', () => {
    const event = {
      type: 'tool_result',
      toolCallId: 'tc_error',
      output: 'Permission denied',
      isError: true,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_result')
    if (parsed.type === 'tool_result') {
      expect(parsed.isError).toBe(true)
    }
  })

  it('defaults isError to false when absent', () => {
    const event = {
      type: 'tool_result',
      toolCallId: 'tc_default',
      output: null,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_result')
    if (parsed.type === 'tool_result') {
      expect(parsed.isError).toBe(false)
    }
  })

  it('rejects tool_result without toolCallId', () => {
    const event = {
      type: 'tool_result',
      output: {},
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── permission_request event ───────────────────────────────────────────────

describe('scanEventSchema — permission_request event', () => {
  it('parses a permission_request event', () => {
    const event = {
      type: 'permission_request',
      requestId: 'perm_001',
      toolName: 'write_file',
      input: { path: '/etc/hosts' },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('permission_request')
    if (parsed.type === 'permission_request') {
      expect(parsed.requestId).toBe('perm_001')
      expect(parsed.toolName).toBe('write_file')
      expect(parsed.timeoutMs).toBe(60000)
    }
  })

  it('parses permission_request with custom timeout', () => {
    const event = {
      type: 'permission_request',
      requestId: 'perm_002',
      toolName: 'execute_command',
      input: { command: 'rm -rf /' },
      timeoutMs: 30000,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('permission_request')
    if (parsed.type === 'permission_request') {
      expect(parsed.timeoutMs).toBe(30000)
    }
  })

  it('defaults timeoutMs to 60000', () => {
    const event = {
      type: 'permission_request',
      requestId: 'perm_003',
      toolName: 'delete_file',
      input: {},
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('permission_request')
    if (parsed.type === 'permission_request') {
      expect(parsed.timeoutMs).toBe(60000)
    }
  })

  it('rejects permission_request without requestId', () => {
    const event = {
      type: 'permission_request',
      toolName: 'test',
      input: {},
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── cost event ─────────────────────────────────────────────────────────────

describe('scanEventSchema — cost event', () => {
  it('parses a cost event with all fields', () => {
    const event = {
      type: 'cost',
      inputTokens: 1500,
      outputTokens: 800,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      costUsd: 0.015,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('cost')
    if (parsed.type === 'cost') {
      expect(parsed.inputTokens).toBe(1500)
      expect(parsed.outputTokens).toBe(800)
      expect(parsed.cacheReadTokens).toBe(200)
      expect(parsed.cacheWriteTokens).toBe(100)
      expect(parsed.costUsd).toBe(0.015)
    }
  })

  it('parses a cost event with only required fields', () => {
    const event = {
      type: 'cost',
      inputTokens: 100,
      outputTokens: 50,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('cost')
    if (parsed.type === 'cost') {
      expect(parsed.inputTokens).toBe(100)
      expect(parsed.outputTokens).toBe(50)
      expect(parsed.cacheReadTokens).toBeUndefined()
      expect(parsed.costUsd).toBeUndefined()
    }
  })

  it('rejects cost with negative inputTokens', () => {
    const event = {
      type: 'cost',
      inputTokens: -1,
      outputTokens: 10,
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects cost with negative outputTokens', () => {
    const event = {
      type: 'cost',
      inputTokens: 10,
      outputTokens: -5,
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── server_info event ──────────────────────────────────────────────────────

describe('scanEventSchema — server_info event', () => {
  it('parses a server_info event with all fields', () => {
    const event = {
      type: 'server_info',
      agentId: 'claude-code',
      agentVersion: '1.0.0',
      capabilities: { tools: true, streaming: true },
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('server_info')
    if (parsed.type === 'server_info') {
      expect(parsed.agentId).toBe('claude-code')
      expect(parsed.agentVersion).toBe('1.0.0')
    }
  })

  it('parses server_info with only agentId (required field)', () => {
    const event = {
      type: 'server_info',
      agentId: 'minimal-agent',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('server_info')
    if (parsed.type === 'server_info') {
      expect(parsed.agentId).toBe('minimal-agent')
      expect(parsed.agentVersion).toBeUndefined()
      expect(parsed.capabilities).toBeUndefined()
    }
  })

  it('rejects server_info without agentId', () => {
    const event = {
      type: 'server_info',
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── file_read event ────────────────────────────────────────────────────────

describe('scanEventSchema — file_read event', () => {
  it('parses a file_read event with preview', () => {
    const event = {
      type: 'file_read',
      path: '/src/app.ts',
      preview: 'import React from "react"',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('file_read')
    if (parsed.type === 'file_read') {
      expect(parsed.path).toBe('/src/app.ts')
      expect(parsed.preview).toBe('import React from "react"')
    }
  })

  it('parses a file_read event without preview', () => {
    const event = {
      type: 'file_read',
      path: '/src/utils.ts',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('file_read')
    if (parsed.type === 'file_read') {
      expect(parsed.path).toBe('/src/utils.ts')
      expect(parsed.preview).toBeUndefined()
    }
  })

  it('rejects file_read with empty path', () => {
    const event = {
      type: 'file_read',
      path: '',
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── file_write event ───────────────────────────────────────────────────────

describe('scanEventSchema — file_write event', () => {
  it('parses a file_write event with preview', () => {
    const event = {
      type: 'file_write',
      path: '/src/new.ts',
      preview: 'export function hello() {}',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('file_write')
    if (parsed.type === 'file_write') {
      expect(parsed.path).toBe('/src/new.ts')
      expect(parsed.preview).toBe('export function hello() {}')
    }
  })

  it('parses a file_write event without preview', () => {
    const event = {
      type: 'file_write',
      path: '/tmp/output.log',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('file_write')
    if (parsed.type === 'file_write') {
      expect(parsed.path).toBe('/tmp/output.log')
      expect(parsed.preview).toBeUndefined()
    }
  })

  it('rejects file_write with empty path', () => {
    const event = {
      type: 'file_write',
      path: '',
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── terminal_output event ──────────────────────────────────────────────────

describe('scanEventSchema — terminal_output event', () => {
  it('parses a terminal_output with command and exitCode 0', () => {
    const event = {
      type: 'terminal_output',
      command: 'npm test',
      output: 'All tests passed!',
      exitCode: 0,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('terminal_output')
    if (parsed.type === 'terminal_output') {
      expect(parsed.command).toBe('npm test')
      expect(parsed.output).toBe('All tests passed!')
      expect(parsed.exitCode).toBe(0)
    }
  })

  it('parses a terminal_output with non-zero exitCode', () => {
    const event = {
      type: 'terminal_output',
      command: 'npm run build',
      output: 'Error: compilation failed',
      exitCode: 1,
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('terminal_output')
    if (parsed.type === 'terminal_output') {
      expect(parsed.exitCode).toBe(1)
    }
  })

  it('parses terminal_output without command (only output)', () => {
    const event = {
      type: 'terminal_output',
      output: 'stdout stream content',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('terminal_output')
    if (parsed.type === 'terminal_output') {
      expect(parsed.output).toBe('stdout stream content')
      expect(parsed.command).toBeUndefined()
      expect(parsed.exitCode).toBeUndefined()
    }
  })

  it('rejects terminal_output without output field', () => {
    const event = {
      type: 'terminal_output',
      command: 'ls',
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── plan event ─────────────────────────────────────────────────────────────

describe('scanEventSchema — plan event', () => {
  it('parses a plan event with multiple steps', () => {
    const event = {
      type: 'plan',
      steps: [
        { title: 'Read codebase', status: 'done' },
        { title: 'Analyze patterns', status: 'in_progress' },
        { title: 'Report findings', status: 'pending' },
      ],
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('plan')
    if (parsed.type === 'plan') {
      expect(parsed.steps).toHaveLength(3)
      expect(parsed.steps[0]).toEqual({ title: 'Read codebase', status: 'done' })
      expect(parsed.steps[1].status).toBe('in_progress')
      expect(parsed.steps[2].status).toBe('pending')
    }
  })

  it('parses a plan with a single step', () => {
    const event = {
      type: 'plan',
      steps: [{ title: 'Single task', status: 'pending' }],
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('plan')
    if (parsed.type === 'plan') {
      expect(parsed.steps).toHaveLength(1)
    }
  })

  it('parses a plan with error status step', () => {
    const event = {
      type: 'plan',
      steps: [
        { title: 'Failed step', status: 'error' },
      ],
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('plan')
    if (parsed.type === 'plan') {
      expect(parsed.steps[0].status).toBe('error')
    }
  })

  it('rejects plan with empty steps array', () => {
    const event = {
      type: 'plan',
      steps: [],
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects plan with invalid status', () => {
    const event = {
      type: 'plan',
      steps: [{ title: 'Bad step', status: 'unknown' }],
    }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── unknown discriminant ───────────────────────────────────────────────────

describe('scanEventSchema — unknown discriminant', () => {
  it('throws ZodError for unknown event type', () => {
    const event = { type: 'some_unknown_event' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('throws ZodError for event without type field', () => {
    const event = { message: 'no type' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── isHighPriorityEvent ────────────────────────────────────────────────────

describe('isHighPriorityEvent — includes permission_request', () => {
  it('returns true for permission_request events', () => {
    const event = {
      type: 'permission_request' as const,
      requestId: 'r1',
      toolName: 't',
      input: null,
      timeoutMs: 60000,
    }
    expect(isHighPriorityEvent(event as any)).toBe(true)
  })

  it('returns true for finding events (existing behavior)', () => {
    const event = {
      type: 'finding',
      finding: {
        title: 'test',
        description: 'test',
        severity: 'info' as const,
        locationPath: 'f.ts',
        locationLineStart: 1,
        detector: 'llm',
      },
    }
    expect(isHighPriorityEvent(event as any)).toBe(true)
  })

  it('returns false for thinking events', () => {
    const event = { type: 'thinking', text: 'hmm', format: 'plain' as const }
    expect(isHighPriorityEvent(event as any)).toBe(false)
  })
})

// ─── v0.3: user_injection event ────────────────────────────────────────────────

describe('scanEventSchema — user_injection event', () => {
  it('parses a valid user_injection event with content', () => {
    const event = { type: 'user_injection', content: 'Focus on the auth module only.' }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('user_injection')
    if (parsed.type === 'user_injection') {
      expect(parsed.content).toBe('Focus on the auth module only.')
      expect(parsed.injectionSource).toBeUndefined()
    }
  })

  it('parses user_injection with optional injectionSource', () => {
    const event = { type: 'user_injection', content: 'Stop after stage 2.', injectionSource: 'user-console' }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('user_injection')
    if (parsed.type === 'user_injection') {
      expect(parsed.injectionSource).toBe('user-console')
    }
  })

  it('rejects user_injection without content', () => {
    const event = { type: 'user_injection', injectionSource: 'user-console' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects user_injection with extra invalid fields (unknown fields are stripped or pass)', () => {
    // Zod strips unknown fields but does not throw — the known fields must still parse
    const event = { type: 'user_injection', content: 'ok', unknownField: 'ignored' }
    expect(() => scanEventSchema.parse(event)).not.toThrow()
  })
})

// ─── v0.3: plan_edit event ─────────────────────────────────────────────────────

describe('scanEventSchema — plan_edit event', () => {
  it('parses a valid plan_edit event', () => {
    const event = { type: 'plan_edit', stepIndex: 2, newContent: 'Check all auth endpoints' }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('plan_edit')
    if (parsed.type === 'plan_edit') {
      expect(parsed.stepIndex).toBe(2)
      expect(parsed.newContent).toBe('Check all auth endpoints')
    }
  })

  it('rejects plan_edit without stepIndex', () => {
    const event = { type: 'plan_edit', newContent: 'something' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects plan_edit without newContent', () => {
    const event = { type: 'plan_edit', stepIndex: 0 }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects plan_edit with non-integer stepIndex', () => {
    const event = { type: 'plan_edit', stepIndex: 1.5, newContent: 'text' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── v0.3: tool_call_rejected event ───────────────────────────────────────────

describe('scanEventSchema — tool_call_rejected event', () => {
  it('parses a valid tool_call_rejected event with toolCallId', () => {
    const event = { type: 'tool_call_rejected', toolCallId: 'tc_danger' }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_call_rejected')
    if (parsed.type === 'tool_call_rejected') {
      expect(parsed.toolCallId).toBe('tc_danger')
      expect(parsed.reason).toBeUndefined()
    }
  })

  it('parses tool_call_rejected with optional reason', () => {
    const event = { type: 'tool_call_rejected', toolCallId: 'tc_del', reason: 'User denied file deletion' }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('tool_call_rejected')
    if (parsed.type === 'tool_call_rejected') {
      expect(parsed.reason).toBe('User denied file deletion')
    }
  })

  it('rejects tool_call_rejected without toolCallId', () => {
    const event = { type: 'tool_call_rejected', reason: 'no id' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})

// ─── v0.3: fork_point event ────────────────────────────────────────────────────

describe('scanEventSchema — fork_point event', () => {
  it('parses a valid fork_point event', () => {
    const event = {
      type: 'fork_point',
      forkId: 'fork-001',
      parentScanId: 'scan-parent-abc',
    }
    const parsed = scanEventSchema.parse(event)
    expect(parsed.type).toBe('fork_point')
    if (parsed.type === 'fork_point') {
      expect(parsed.forkId).toBe('fork-001')
      expect(parsed.parentScanId).toBe('scan-parent-abc')
    }
  })

  it('rejects fork_point without forkId', () => {
    const event = { type: 'fork_point', parentScanId: 'scan-abc' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })

  it('rejects fork_point without parentScanId', () => {
    const event = { type: 'fork_point', forkId: 'fork-001' }
    expect(() => scanEventSchema.parse(event)).toThrow()
  })
})
