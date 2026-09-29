import { describe, it, expect } from 'vitest'
import { SessionUpdateHandler } from '@/lib/providers/transport/session-update-handler'
import type {
  ToolCallEvent,
  ToolResultEvent,
  PlanEvent,
  CostEvent,
  ServerInfoEvent,
} from '@/lib/providers/transport/session-update-handler'
import type { SessionNotification } from '@agentclientprotocol/sdk'

/**
 * Builds a minimal SessionNotification with the given update payload.
 * The update is cast through unknown to satisfy the SessionUpdate discriminated union
 * without requiring full SDK type compliance for test objects.
 */
function makeNotification(update: Record<string, unknown>): SessionNotification {
  return {
    sessionId: 'test-session-1',
    update: update as SessionNotification['update'],
  }
}

describe('SessionUpdateHandler', () => {
  const handler = new SessionUpdateHandler()

  describe('dispatch()', () => {
    // ---- Table-driven: known variants ----
    const cases: {
      label: string
      notification: SessionNotification
      expectedType: string
      expectedCount: number
      assertFn: (events: ReturnType<typeof handler.dispatch>) => void
    }[] = [
      {
        label: 'tool_call → ToolCallEvent',
        notification: makeNotification({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          title: 'Reading file',
          rawInput: { filePath: '/src/app.ts' },
        }),
        expectedType: 'tool_call',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ToolCallEvent
          expect(e.type).toBe('tool_call')
          expect(e.toolCallId).toBe('tc-1')
          expect(e.toolName).toBe('Reading file')
          expect(e.input).toEqual({ filePath: '/src/app.ts' })
        },
      },
      {
        label: 'tool_call with minimal fields (no rawInput)',
        notification: makeNotification({
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-2',
          title: 'Searching',
        }),
        expectedType: 'tool_call',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ToolCallEvent
          expect(e.type).toBe('tool_call')
          expect(e.toolCallId).toBe('tc-2')
          expect(e.toolName).toBe('Searching')
          expect(e.input).toBeNull()
        },
      },
      {
        label: 'tool_call_update → ToolResultEvent',
        notification: makeNotification({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-3',
          status: 'completed',
          rawOutput: { result: 42 },
        }),
        expectedType: 'tool_result',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ToolResultEvent
          expect(e.type).toBe('tool_result')
          expect(e.toolCallId).toBe('tc-3')
          expect(e.output).toEqual({ result: 42 })
          expect(e.isError).toBe(false)
        },
      },
      {
        label: 'tool_call_update failed → ToolResultEvent with isError=true',
        notification: makeNotification({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-4',
          status: 'error',
          rawOutput: 'Permission denied',
        }),
        expectedType: 'tool_result',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ToolResultEvent
          expect(e.type).toBe('tool_result')
          expect(e.toolCallId).toBe('tc-4')
          expect(e.output).toBe('Permission denied')
          expect(e.isError).toBe(true)
        },
      },
      {
        label: 'tool_call_update with no output → ToolResultEvent with null output',
        notification: makeNotification({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-5',
          status: 'completed',
        }),
        expectedType: 'tool_result',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ToolResultEvent
          expect(e.type).toBe('tool_result')
          expect(e.toolCallId).toBe('tc-5')
          expect(e.output).toBeNull()
          expect(e.isError).toBe(false)
        },
      },
      {
        label: 'plan → PlanEvent',
        notification: makeNotification({
          sessionUpdate: 'plan',
          entries: [
            { content: 'Analyze codebase', status: 'completed' },
            { content: 'Find vulnerabilities', status: 'in_progress' },
            { content: 'Generate report', status: 'pending' },
          ],
        }),
        expectedType: 'plan',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as PlanEvent
          expect(e.type).toBe('plan')
          expect(e.steps).toHaveLength(3)
          expect(e.steps[0]).toEqual({ status: 'completed', title: 'Analyze codebase' })
          expect(e.steps[1]).toEqual({ status: 'in_progress', title: 'Find vulnerabilities' })
          expect(e.steps[2]).toEqual({ status: 'pending', title: 'Generate report' })
        },
      },
      {
        label: 'plan with empty entries → PlanEvent with empty steps',
        notification: makeNotification({
          sessionUpdate: 'plan',
          entries: [],
        }),
        expectedType: 'plan',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as PlanEvent
          expect(e.type).toBe('plan')
          expect(e.steps).toEqual([])
        },
      },
      {
        label: 'usage_update with cost → CostEvent',
        notification: makeNotification({
          sessionUpdate: 'usage_update',
          usage: { inputTokens: 15000, outputTokens: 5000 },
          cost: { amount: 0.042, currency: 'USD' },
        }),
        expectedType: 'cost',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as CostEvent
          expect(e.type).toBe('cost')
          expect(e.inputTokens).toBe(15000)
          expect(e.outputTokens).toBe(5000)
          expect(e.costUsd).toBe(0.042)
        },
      },
      {
        label: 'usage_update without cost → CostEvent with undefined costUsd',
        notification: makeNotification({
          sessionUpdate: 'usage_update',
          usage: { inputTokens: 5000, outputTokens: 2000 },
        }),
        expectedType: 'cost',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as CostEvent
          expect(e.type).toBe('cost')
          expect(e.inputTokens).toBe(5000)
          expect(e.outputTokens).toBe(2000)
          expect(e.costUsd).toBeUndefined()
        },
      },
      {
        label: 'session_info_update → ServerInfoEvent',
        notification: makeNotification({
          sessionUpdate: 'session_info_update',
          sessionId: 'ses-abc',
          title: 'opencode v1.2.3',
          updatedAt: '2025-01-15T10:30:00Z',
        }),
        expectedType: 'server_info',
        expectedCount: 1,
        assertFn: (events) => {
          const e = events[0] as ServerInfoEvent
          expect(e.type).toBe('server_info')
          expect(e.agentId).toBe('test-session-1')
          expect(e.agentVersion).toBe('opencode v1.2.3')
        },
      },
    ]

    for (const tc of cases) {
      it(tc.label, () => {
        const events = handler.dispatch(tc.notification)
        expect(events).toHaveLength(tc.expectedCount)
        expect(events[0].type).toBe(tc.expectedType)
        tc.assertFn(events)
      })
    }

    // ---- Unknown notification type → no event emitted ----
    it('ignores unknown sessionUpdate types (empty array)', () => {
      const notification = makeNotification({
        sessionUpdate: 'user_message_chunk',
        content: 'hello',
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })

    it('ignores available_commands_update', () => {
      const notification = makeNotification({
        sessionUpdate: 'available_commands_update',
        commands: [],
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })

    it('ignores current_mode_update', () => {
      const notification = makeNotification({
        sessionUpdate: 'current_mode_update',
        modeId: 'architect',
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })

    it('ignores config_option_update', () => {
      const notification = makeNotification({
        sessionUpdate: 'config_option_update',
        configId: 'theme',
        value: 'dark',
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })

    it('ignores agent_message_chunk', () => {
      const notification = makeNotification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })

    it('ignores agent_thought_chunk', () => {
      const notification = makeNotification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking...' },
      })
      const events = handler.dispatch(notification)
      expect(events).toEqual([])
    })
  })
})
