# UI Components Specification

## Purpose

Defines the new React components (`ToolCallBlock`, `PermissionDialog`, `CostBadge`, `PlanBlock`, `TerminalOutputBlock`) and the enriched `ScanProgress.tsx` that consumes the new event taxonomy.

## Requirements

### Requirement: ToolCallBlock Component

`components/ui/ToolCallBlock.tsx` MUST render a collapsible block showing tool name and input. It MUST accept props `{ toolName: string, toolCallId: string, input: unknown, result?: unknown, isError?: boolean }`. When `result` is provided, the block MUST display the result inline or in an expanded section.

#### Scenario: Renders tool name prominently

- GIVEN `<ToolCallBlock toolName="read_file" toolCallId="tc-1" input={{ path: '/app/page.tsx' }} />`
- WHEN rendered
- THEN the text `read_file` MUST appear in the output
- AND the block MUST be in a collapsed state by default

#### Scenario: Expands on click

- GIVEN a collapsed `ToolCallBlock`
- WHEN the user clicks the expand trigger
- THEN the input MUST be visible as formatted JSON or structured content

#### Scenario: Error state visually distinct

- GIVEN `isError={true}` and a `result` value
- WHEN rendered
- THEN the component MUST apply a visual error indicator (e.g., red border or error icon)

---

### Requirement: PermissionDialog Component

`components/ui/PermissionDialog.tsx` MUST render a modal or inline dialog asking the user to approve or deny a permission request. It MUST accept props `{ requestId: string, toolName: string, input: unknown, timeoutMs: number, scanId: string, onSettled: () => void }`. Clicking approve MUST call `POST /api/scans/{scanId}/permission` with `{ requestId, approved: true }`. Clicking deny MUST call the same endpoint with `approved: false`. After either call completes, `onSettled` MUST be called.

#### Scenario: Approve button calls POST with approved:true

- GIVEN a `PermissionDialog` for `requestId: 'pr-1'` and `scanId: 's-1'`
- WHEN the user clicks "Approve"
- THEN `POST /api/scans/s-1/permission` MUST be called with `{ requestId: 'pr-1', approved: true }`
- AND `onSettled()` MUST be called after the response

#### Scenario: Deny button calls POST with approved:false

- GIVEN the same dialog
- WHEN the user clicks "Deny"
- THEN `POST /api/scans/s-1/permission` MUST be called with `{ requestId: 'pr-1', approved: false }`

#### Scenario: Countdown timer visible

- GIVEN `timeoutMs: 60000`
- WHEN the dialog renders
- THEN a countdown display (seconds remaining) MUST be visible and decrement each second

#### Scenario: Dialog auto-dismisses on timeout

- GIVEN the countdown reaches zero
- WHEN the timer fires
- THEN the dialog MUST close and `onSettled()` MUST be called without making a POST

---

### Requirement: CostBadge Component

`components/ui/CostBadge.tsx` MUST render a compact badge showing token counts and optional cost in USD. It MUST accept props `{ inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number, costUsd?: number }`. When `costUsd` is provided, it MUST be formatted as `$0.0000` (4 decimal places).

#### Scenario: Renders token counts

- GIVEN `<CostBadge inputTokens={1200} outputTokens={300} />`
- WHEN rendered
- THEN `1200` and `300` MUST appear in the output

#### Scenario: Cost formatted to 4 decimals

- GIVEN `costUsd={0.00342}`
- WHEN rendered
- THEN the text `$0.0034` MUST appear (round to 4 decimal places)

---

### Requirement: PlanBlock Component

`components/ui/PlanBlock.tsx` MUST render an ordered list of plan steps with status indicators. Props: `{ steps: Array<{ title: string, status: 'pending' | 'in_progress' | 'done' | 'error' }> }`. Each status MUST use a distinct visual indicator (icon or color).

#### Scenario: Renders all steps

- GIVEN 3 steps in various states
- WHEN rendered
- THEN all 3 step titles MUST appear in document order

#### Scenario: in_progress step highlighted

- GIVEN one step has `status: 'in_progress'`
- WHEN rendered
- THEN that step MUST have a visually distinct style (e.g., spinner or highlighted color)

---

### Requirement: TerminalOutputBlock Component

`components/ui/TerminalOutputBlock.tsx` MUST render terminal output in a monospace block. Props: `{ command?: string, output: string, exitCode?: number }`. When `exitCode` is not `0` (and is defined), the exit code MUST be displayed in a visually distinct error style.

#### Scenario: Command and output displayed

- GIVEN `command="npm test"` and `output="PASS 12 tests"`
- WHEN rendered
- THEN both the command and output MUST appear

#### Scenario: Non-zero exitCode styled as error

- GIVEN `exitCode={1}`
- WHEN rendered
- THEN the exit code display MUST carry an error visual indicator

---

### Requirement: ScanProgress Renders New Event Types

`app/scans/[id]/ScanProgress.tsx` MUST render each new event type using the corresponding component. The mapping MUST be:

| Event type | Component |
|---|---|
| `tool_call` | `ToolCallBlock` |
| `tool_result` | appended to the matching `ToolCallBlock` |
| `permission_request` | `PermissionDialog` (interactive) or no-op (scan mode) |
| `cost` | `CostBadge` |
| `plan` | `PlanBlock` |
| `terminal_output` | `TerminalOutputBlock` |
| `file_read` / `file_write` | inline path annotation within the event stream |

#### Scenario: tool_call event renders ToolCallBlock

- GIVEN a `tool_call` event arrives on the SSE stream
- WHEN `ScanProgress` processes it
- THEN a `ToolCallBlock` MUST appear in the rendered output with the correct `toolName`

#### Scenario: tool_result matched to existing ToolCallBlock

- GIVEN a prior `tool_call` with `toolCallId: 'tc-1'` and then a `tool_result` with the same id
- WHEN both events are processed
- THEN the result MUST be attached to the same `ToolCallBlock` UI element, NOT rendered as a separate block

#### Scenario: permission_request in interactive mode shows PermissionDialog

- GIVEN `opts.mode === 'interactive'` and a `permission_request` event arrives
- WHEN `ScanProgress` processes it
- THEN a `PermissionDialog` MUST become visible

#### Scenario: cost event adds CostBadge

- GIVEN a `cost` event arrives
- WHEN `ScanProgress` processes it
- THEN a `CostBadge` MUST be rendered with the correct token counts

---

### Requirement: No Hardcoded .obt Paths in UI

All UI components and `ScanProgress.tsx` MUST NOT contain hardcoded `.obt` path strings. Any file path display MUST use path values sourced from event data only.

#### Scenario: No .obt literal in component files

- GIVEN all files under `components/ui/` and `app/scans/`
- WHEN statically analyzed
- THEN no string literal matching `\.obt` MUST appear
