# open-security — Design System

> Premium Blue Team security workbench. Token-driven, implementation-ready design guidance optimized for consistency, accessibility, and fast delivery.

---

## 1. Context and Goals

### Mission
Provide implementation-ready, token-driven UI guidance for the open-security workbench that delivers a premium, professional security tool experience — never a "hacker tool" aesthetic.

### Product
- **Name**: open-security
- **Audience**: Security engineers, Blue Team practitioners, developers
- **Surface**: Single-page application with fixed sidebar + scrollable main content
- **Stack**: Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4

### Design Intent
**Restrained confidence.** Content is the hero. Orange accent used like a highlighter, not a paintbrush. Black-on-white for light theme, white-on-near-black for dark. No terminal green, no matrix rain, no gradients. A professional tool built for clarity and speed under pressure.

---

## 2. Design Tokens and Foundations

### 2.1 Semantic Color Tokens

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `color.bg` | `#FFFFFF` | `#0A0A0A` | Page background |
| `color.surface` | `#F8F8F8` | `#141414` | Card, sidebar, elevated surfaces |
| `color.surface.hover` | `#F0F0F0` | `#1A1A1A` | Hover state on surface elements |
| `color.fg` | `#0A0A0A` | `#FAFAFA` | Primary text |
| `color.fg.secondary` | `rgba(10,10,10,0.6)` | `rgba(250,250,250,0.5)` | Secondary text, captions |
| `color.fg.muted` | `rgba(10,10,10,0.4)` | `rgba(250,250,250,0.3)` | Placeholders, disabled |
| `color.border` | `#E5E5E5` | `#2A2A2A` | Separators, input borders |
| `color.accent` | `#F97316` | `#F97316` | Primary actions, highlights, focus rings |
| `color.accent.muted` | `rgba(249,115,22,0.1)` | `rgba(249,115,22,0.1)` | Active nav backgrounds |
| `color.danger` | `#EF4444` | `#EF4444` | Critical severity, destructive actions |
| `color.warning` | `#F59E0B` | `#F59E0B` | Medium severity, attention flags |
| `color.success` | `#10B981` | `#10B981` | Done status, low risk |

### 2.2 Typography

```css
font.family.primary: Inter, -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
font.family.mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
font.size.base: 16px
font.weight.base: 400
font.lineHeight.base: 1.6
```

**Scale**

| Token | Value | Usage |
|-------|-------|-------|
| `font.size.xs` | 11px | Badge labels (small) |
| `font.size.sm` | 12px | Badges, labels, fine print |
| `font.size.md` | 13px | Tab labels, compact UI |
| `font.size.base` | 14px | Buttons, secondary text |
| `font.size.lg` | 16px | Body text, inputs, default |
| `font.size.xl` | 18px | Card titles |
| `font.size.2xl` | 20px | Section headings |
| `font.size.3xl` | 24px | Page titles |

**Line Height**
- Body: 1.6 — readable for dense security reports
- Headings: 1.3 — tight visual grouping
- Monospace: 1.5 — diff/code blocks

**Font Features**
- `font-feature-settings: "tnum"` for tabular numbers — scan IDs, timestamps, counts
- Inter loaded via `next/font/google` with `display: swap`

### 2.3 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `space.1` | 2px | Minimal gap |
| `space.2` | 4px | Icon-to-text gap |
| `space.3` | 8px | Badge padding x, tight gap |
| `space.4` | 10px | Compact gap |
| `space.5` | 12px | Button padding x (sm), card body |
| `space.6` | 16px | Default gap, card padding (sm) |
| `space.7` | 24px | Card padding (md), section gap |
| `space.8` | 32px | Page padding, card padding (lg) |

### 2.4 Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius.xs` | 4px | Focus ring offset |
| `radius.sm` | 6px | Buttons, inputs |
| `radius.md` | 8px | Cards |
| `radius.lg` | 10px | Large cards, modals |
| `radius.xl` | 100px | Badges (pill) |

### 2.5 Shadow Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `shadow.1` | `rgba(180,90,30,0.06) 0px 1px 3px 0px` | Card default |
| `shadow.2` | `rgba(180,90,30,0.10) 0px 2px 6px 0px` | Card hover lift |
| `shadow.3` | `rgba(10,10,10,0.04) 0px 1px 2px 0px` | Subtle elevation |
| `shadow.4` | `rgba(15,12,8,0.92) 0px -2px 0px 0px inset` | Active press (future) |

### 2.6 Motion

| Token | Value | Usage |
|-------|-------|-------|
| `motion.duration.instant` | 100ms | Button press feedback |
| `motion.duration.fast` | 120ms | Hover transitions |
| `motion.duration.normal` | 150ms | Page transitions, theme toggle |
| `motion.easing` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard ease-out |

**Motion constraints**: No animation duration faster than 100ms or slower than 150ms. Respect `prefers-reduced-motion: reduce` — disable all non-essential motion.

### 2.7 Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Base | < 640px | Single column, stacked cards |
| `sm` | ≥ 640px | Two columns |
| `md` | ≥ 768px | Sidebar + content |
| `lg` | ≥ 1024px | Full layout, data tables |
| `xl` | ≥ 1280px | Wide dashboards |

**Container**: `max-width: 1280px` centered for content pages. Sidebar: fixed 220px left.

---

## 3. Component Rules

Every component must define states for: **default, hover, focus-visible, active, disabled, loading, error**. Interactive components must document **keyboard, pointer, and touch behavior**.

### 3.1 Button

**Anatomy**: `<button>` with inline-flex layout, icon slots (left/right), optional loading spinner.

**Variants**:
| Variant | Background | Border | Text | Usage |
|---------|-----------|--------|------|-------|
| `primary` | `color.accent` | none | white | Main CTA — one per view maximum |
| `secondary` | transparent | `color.border` | `color.fg` | Alternative actions |
| `ghost` | transparent | none | `color.fg.secondary` | Toolbar, inline actions |
| `danger` | `color.danger` | none | white | Destructive actions |

**States**:
- **default**: variant background/border applied
- **hover**: `brightness(1.1)` filter — must transition in `motion.duration.fast`
- **focus-visible**: `ring-2 ring-accent/30 ring-offset-2 ring-offset-bg` — must never be removed
- **active**: `brightness(0.95)` filter
- **disabled**: `opacity: 0.5`, `pointer-events: none`, `aria-disabled="true"`
- **loading**: spinner SVG replaces `iconLeft`, button disabled, `aria-busy="true"`

**Sizes**: `sm` (32px height, `padding: 0 12px`, `font-size: 12px`), `md` (40px, 16px, 13px), `lg` (48px, 24px, 14px).

**Keyboard**: Enter or Space triggers click. **Pointer**: `cursor: pointer`. **Touch**: minimum 44px touch target.

**Accessibility acceptance**:
- [ ] Focus ring visible on keyboard tab
- [ ] `aria-label` present when icon-only (no text children)
- [ ] `aria-busy="true"` when loading
- [ ] Contrast ratio ≥ 3:1 for text on accent/danger backgrounds

### 3.2 Card

**Anatomy**: Compound component — `Card` (container) + `Card.Header` + `Card.Body` + `Card.Footer`.

**Variants**:
| Prop | Values | Effect |
|------|--------|--------|
| `padding` | `sm` (16px), `md` (24px), `lg` (32px) | Internal padding |
| `hover` | `true \| false` | Adds `shadow.2` on hover, `transition-shadow motion.duration.fast` |

**States**:
- **default**: `bg-surface border border-border rounded-lg shadow.1`
- **hover** (when `hover=true`): `shadow.2`
- **focus-visible** (when wrapping a link): parent link focus ring

**Overflow**: Content that exceeds card width must scroll or truncate. Cards must not push their container wider.

**Accessibility acceptance**:
- [ ] Card is a `<div>` (not interactive unless wrapped in `<a>` or `<button>`)
- [ ] Heading hierarchy preserved inside card (Card.Header uses `<h3>`)

### 3.3 Tabs

**Anatomy**: `<div role="tablist">` with `<button role="tab">` children. Active tab has `0.5px` bottom border in `color.accent`. Panel content in `<div role="tabpanel">`.

**States**:
- **default (inactive)**: `text-fg/50`
- **hover**: `text-fg/80`
- **focus-visible**: `ring-2 ring-accent/30 ring-inset`
- **active**: `text-fg` + accent underline
- **disabled** (future): `opacity-40 pointer-events-none`

**Keyboard**: ArrowLeft/Right navigates between tabs. Home/End jumps to first/last. **Touch**: horizontal scroll via `overflow-x-auto` on narrow screens.

**Edge cases**: Tab bar must scroll horizontally when content overflows on mobile. All panels render in DOM (hidden attribute), not conditionally unmounted.

**Accessibility acceptance**:
- [ ] `role="tablist"` on container, `role="tab"` on buttons
- [ ] `aria-selected` reflects active state
- [ ] `aria-controls` links tab to panel
- [ ] ArrowLeft/Right navigation functional
- [ ] `tabIndex={active ? 0 : -1}` on tab buttons

### 3.4 Badge

**Anatomy**: `<span>` with `rounded-full` (pill), inline-flex, `font-medium`.

**Variants**:
| Type | Colors | Usage |
|------|--------|-------|
| `severity="critical"` | `bg-red-500/15 text-red-600` | CVSS 9.0+ |
| `severity="high"` | `bg-orange-500/15 text-orange-600` | CVSS 7.0-8.9 |
| `severity="medium"` | `bg-yellow-500/15 text-yellow-600` | CVSS 4.0-6.9 |
| `severity="low"` | `bg-blue-500/15 text-blue-600` | CVSS 0.1-3.9 |
| `severity="info"` | `bg-gray-500/15 text-gray-500` | Informational |
| `status="pending"` | `bg-gray-500/15 text-gray-500` | Queued |
| `status="running"` | `bg-blue-500/15 text-blue-600` | In progress |
| `status="done"` | `bg-green-500/15 text-green-600` | Completed |
| `status="failed"` | `bg-red-500/15 text-red-600` | Errored |
| `status="cancelled"` | `bg-yellow-500/15 text-yellow-600` | Aborted |

**Sizes**: `sm` (11px, `padding: 2px 8px`), `md` (12px, `padding: 4px 10px`).

**Overflow**: Text must not wrap. Long content must truncate with ellipsis.

**Accessibility acceptance**:
- [ ] Color is not the only differentiator — text content conveys meaning
- [ ] Contrast ratio ≥ 4.5:1 for text against 15% opacity background

### 3.5 ThemeToggle

**Anatomy**: `<button>` with two SVG icons (sun/moon). Icons cross-fade via `opacity` + `scale` + `rotate` transitions.

**States**: Same as Button (ghost variant). **Loading**: N/A (instant toggle).

**Persistence**: `localStorage.setItem("obt-theme")`, `document.cookie`, `document.documentElement.dataset.theme`. Server reads cookie in layout to prevent flash.

**System preference**: On first visit without stored preference, respect `prefers-color-scheme`.

**Accessibility acceptance**:
- [ ] `aria-label="Toggle theme"` on button
- [ ] `aria-hidden="true"` on the inactive icon
- [ ] Reduced motion: disable rotation animation

### 3.6 Sidebar

**Anatomy**: Fixed `<aside>` (220px) containing: brand header, `<nav>` with SVG icons + labels, project flow section (conditional), ThemeToggle.

**States**:
- **Navigation links**: active (`bg-accent/10 text-accent`) vs inactive (`text-fg/50`)
- **Project flow**: `idle` → `new_project` → `config` → `scanning` — managed internally

**Edge cases**: Must handle overflow when scan config content exceeds sidebar height. Project flow section is `overflow-y-auto`.

**Accessibility acceptance**:
- [ ] `<aside>` landmark with `aria-label` or `<nav>` children
- [ ] Active nav link indicated by both color and background
- [ ] Keyboard accessible: all interactive elements in tab order

### 3.7 Page Components

All page components must define **loading, empty, error, and edge states**.

**Dashboard** (Server Component):
- **Loading**: (handled by Next.js Suspense boundary — future)
- **Empty**: Getting-started guide with feature bullets
- **Error**: Not applicable (reads from local DB, no network)
- **Edge**: 0 projects, 1 project, 100+ projects — grid must scale

**Scan Progress** (Client Component):
- **Loading**: SSE connecting state
- **Empty**: Not applicable (always has a scan)
- **Error**: SSE connection failure → show error message with retry
- **Edge**: Rapid events, slow events, connection drop, page refresh

**Reports** (Server Component):
- **Loading**: (Suspense — future)
- **Empty**: "No reports yet" with guidance
- **Error**: Not applicable (local DB)
- **Edge**: 0 completed scans, 50+ completed scans

---

## 4. Accessibility (WCAG 2.2 AA)

Every accessibility rule must be testable in implementation.

### 4.1 Color Contrast

| Pair | Ratio | Pass |
|------|-------|------|
| `#0A0A0A` on `#FFFFFF` | 18.8:1 | AAA |
| `#FAFAFA` on `#0A0A0A` | 18.6:1 | AAA |
| `#FFFFFF` on `#F97316` | 3.5:1 | AA (large text only) |
| `#EF4444` on `#FFFFFF` | 4.5:1 | AA |

**Acceptance**: Orange is accent only — never used for body text. Semantic badge text must meet 4.5:1 against its 15% opacity background.

### 4.2 Focus Indicators

- [ ] Every interactive element must show `ring-2 ring-accent/30 ring-offset-2` on `:focus-visible`
- [ ] Focus ring must never be removed via `outline: none` without replacement
- [ ] Tab order must follow visual order

### 4.3 Keyboard

- [ ] All interactive elements reachable via Tab
- [ ] Tabs: ArrowLeft/Right navigation functional
- [ ] Enter/Space activates buttons and links
- [ ] Escape closes modals/flyouts (future)

### 4.4 Screen Readers

- [ ] Icon-only buttons must have `aria-label`
- [ ] Tabs must use `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`
- [ ] Decorative icons must use `aria-hidden="true"`
- [ ] Dynamic content updates must use `aria-live` regions (future)

### 4.5 Semantic HTML

- [ ] `<nav>` for navigation, `<main>` for content, `<aside>` for sidebar
- [ ] `<button>` for clickable actions — never `<div onclick>`
- [ ] Headings follow hierarchical order (h1 → h2 → h3)

---

## 5. Content and Tone

### Writing Style
Concise, confident, implementation-focused. No marketing language. No emoji in UI. No exclamation marks in error messages.

### Labels
- Buttons: verb + noun ("Start Scan", "Create Project", "Export Report")
- Empty states: what's missing + what to do ("No scans yet. Create one to begin.")
- Errors: what happened + what to do ("Connection lost. Retry.")

### Formatting
- Dates: locale-aware short format (`new Date().toLocaleDateString()`)
- Numbers: `tabular-nums` for scan IDs, counts, timestamps
- File paths: monospace font

---

## 6. Anti-Patterns

These implementations are **prohibited**:

- Gradients (linear, radial, conic)
- Glass morphism, backdrop blur, frosted glass
- Box shadows heavier than `shadow.2` except for intentional hover lift
- Borders thicker than 1px
- Animated backgrounds, particle effects, decorative motion
- Emoji in UI (except user-provided content)
- All-caps labels (use `font-weight` instead)
- Transitions faster than 100ms or slower than 150ms
- More than one `color.accent` element visible simultaneously
- One-off spacing or typography exceptions
- Low-contrast text or hidden focus indicators
- Ambiguous labels or non-descriptive action text

---

## 7. QA Checklist

Before merging any UI change, verify:

### Visual
- [ ] Light theme renders correctly
- [ ] Dark theme renders correctly
- [ ] All component states visible (hover, focus, active, disabled, loading)
- [ ] No unintended layout shift on state change
- [ ] Responsive at 320px, 768px, 1280px widths

### Accessibility
- [ ] Tab through entire page — every interactive element reachable
- [ ] Focus rings visible on all interactive elements
- [ ] `aria-label` on icon-only buttons
- [ ] Color contrast passes WCAG AA for all text
- [ ] Screen reader announces dynamic content changes

### Code
- [ ] No raw hex values — use semantic CSS tokens or Tailwind classes
- [ ] No inline styles except dynamic values
- [ ] `'use client'` directive only where needed (state, effects, event handlers)
- [ ] DESIGN.md updated to reflect changes

### Testing
- [ ] Unit tests pass for modified components
- [ ] No test regressions in unrelated modules
- [ ] `tsc --noEmit` passes with zero errors

---

## 8. File Map

```
app/
  globals.css              CSS custom properties, Tailwind v4 theme, base styles
  layout.tsx               Root layout, font, theme cookie, Shell wrapper
  page.tsx                 Dashboard — project grid + getting started
  reports/page.tsx         Reports — completed scans with export buttons
  scans/[id]/
    page.tsx               Scan wrapper (server)
    ScanProgress.tsx       SSE streaming + pipeline indicator (client)
    findings/[fid]/
      page.tsx             Finding detail (server)
      FindingActions.tsx   Mark FP / Delete buttons (client)
  timeline/[scanId]/page.tsx  Commit timeline
  authors/[scanId]/page.tsx   Author profiles
  config/page.tsx             Provider matrix + prereqs
components/
  Shell.tsx                Sidebar + main content layout
  Sidebar.tsx              Fixed sidebar: nav + project flow + ThemeToggle
  theme/ThemeToggle.tsx    Light/dark toggle with persistence
  ui/
    Button.tsx             Primary, secondary, ghost, danger
    Card.tsx               Compound card with header/body/footer
    Tabs.tsx               Keyboard-navigable horizontal tabs
    Badge.tsx              Severity and status pill badges
  project/
    NewProjectForm.tsx     Project name + source URL with auto-detect
    ScanConfig.tsx         Intensity, model, git history, deps toggles
  findings/FindingsTable.tsx  Sortable findings table
  chat/ChatSidebar.tsx        Collapsible chat sidebar (stub)
bin/
  obt.ts                   CLI entry point (scan, history, report, agents)
```

---

## Credits

Design system structured with Claude Design methodology. Visual direction: Apple Human Interface Guidelines + Stripe restraint + Linear clarity. Typeface: Inter (Rasmus Andersson). Color palette anchored on Tailwind CSS v4 and Claude Design semantic tokens.
