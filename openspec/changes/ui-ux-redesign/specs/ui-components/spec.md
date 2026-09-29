# Delta for UI Components

## ADDED Requirements

### Requirement: REQ-UIR-21 Shadcn Primitive Replacement

The system MUST remove `components/ui/Button.tsx`, `components/ui/Card.tsx`, `components/ui/Tabs.tsx` custom implementations and replace all their usages with direct imports from `@/components/ui/` shadcn primitives. `components/ui/Badge.tsx` MUST be extended with severity variants (critical, high, medium, low, info) using the new accent and semantic color tokens; it MUST NOT be replaced wholesale.

#### Scenario: No custom Button in codebase

- GIVEN all files under `components/ui/`
- WHEN statically analyzed
- THEN `Button.tsx`, `Card.tsx`, `Tabs.tsx` MUST NOT export custom implementations
- AND all import sites MUST reference shadcn components

#### Scenario: Badge severity variant renders correctly

- GIVEN `<Badge variant="critical" />`
- WHEN rendered
- THEN the component MUST apply danger-token color styling from CSS custom properties

---

### Requirement: REQ-UIR-22 ScanProgress Restyled to New Tokens

`app/scans/[id]/ScanProgress.tsx` MUST apply new design tokens throughout: background uses `--bg`, surface cards use `--surface`, text uses `--fg`/`--fg-secondary`, borders use `--border`. No hardcoded hex colors or Tailwind palette classes bypassing the token layer are permitted.

#### Scenario: Token classes in ScanProgress

- GIVEN `ScanProgress.tsx`
- WHEN statically analyzed
- THEN no hardcoded hex color string MUST appear
- AND all color classes MUST reference CSS custom property tokens

---

### Requirement: REQ-UIR-23 Stage Pipeline Indicators

The left panel of ScanProgress MUST display 5 pipeline stages with distinct status indicators: pending (muted), running (accent animated), done (success), failed (danger). Status MUST update in real time as SSE events arrive.

#### Scenario: Stage transitions from pending to running

- GIVEN a scan that enters stage 2 (Secrets)
- WHEN the corresponding SSE event arrives
- THEN stage 2 indicator MUST switch from pending to running style
- AND stage 1 MUST show done style if previously completed

#### Scenario: Failed stage shows danger style

- GIVEN a scanner stage fails
- WHEN the failure event arrives
- THEN the affected stage indicator MUST apply danger token styling

## MODIFIED Requirements

### Requirement: ToolCallBlock Component

`components/ui/ToolCallBlock.tsx` MUST render a collapsible block showing tool name and input. It MUST accept props `{ toolName: string, toolCallId: string, input: unknown, result?: unknown, isError?: boolean }`. When `result` is provided, the block MUST display the result inline or in an expanded section. All colors MUST use CSS custom property tokens from the new design system; no hardcoded values permitted.
(Previously: component had no token constraint — hex colors and Tailwind palette classes were acceptable)

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
- THEN the component MUST apply a visual error indicator using the `--danger` token
