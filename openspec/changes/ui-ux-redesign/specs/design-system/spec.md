# Design System Specification

## Purpose

Defines the visual language: typography, color tokens, theme switching, and motion policy.

## Requirements

### Requirement: REQ-UIR-01 Typography Fonts

The system MUST load Plus Jakarta Sans via `next/font/google` with `display: swap` for all UI text and Fira Code for all monospace content.

#### Scenario: Fonts available on first render

- GIVEN the app loads in any route
- WHEN the document renders
- THEN the CSS font-family for body text MUST resolve to Plus Jakarta Sans
- AND monospace elements MUST resolve to Fira Code

---

### Requirement: REQ-UIR-02 Color Token CSS Custom Properties

The system MUST define all semantic tokens as CSS custom properties on `:root` and `[data-theme="dark"]`: `--bg`, `--surface`, `--fg`, `--fg-secondary`, `--fg-muted`, `--border`, `--accent` (#F97316), `--accent-surface` (#FFF7ED), `--accent-hover` (#EA580C), `--danger`, `--warning`, `--success`.

#### Scenario: Accent token available in both themes

- GIVEN `data-theme="light"` on `<html>`
- WHEN any element reads `var(--accent)`
- THEN the resolved value MUST be #F97316
- AND switching to `data-theme="dark"` MUST preserve the same accent value

---

### Requirement: REQ-UIR-03 Theme Persistence

The system MUST initialize theme from `prefers-color-scheme` on first visit. Subsequent visits MUST read `localStorage` key `"obt-theme"` first. Theme changes MUST be written to `localStorage` immediately.

#### Scenario: First visit respects OS preference

- GIVEN no `"obt-theme"` key in localStorage
- WHEN the page loads in a dark-mode OS
- THEN `data-theme="dark"` MUST be set on `<html>` before first paint

#### Scenario: Stored preference overrides OS

- GIVEN `localStorage["obt-theme"] = "light"` and dark OS preference
- WHEN the page loads
- THEN `data-theme="light"` MUST be applied

---

### Requirement: REQ-UIR-04 ThemeToggle Accessibility

The ThemeToggle button MUST display a sun icon in dark mode and a moon icon in light mode. It MUST carry an `aria-label` describing the action ("Switch to light mode" / "Switch to dark mode"). All transitions MUST be suppressed when `prefers-reduced-motion: reduce` is set.

#### Scenario: aria-label reflects current action

- GIVEN current theme is dark
- WHEN the ThemeToggle renders
- THEN `aria-label` MUST equal "Switch to light mode"

#### Scenario: No animation under reduced motion

- GIVEN `prefers-reduced-motion: reduce` in the OS
- WHEN the theme toggles
- THEN no CSS transition or animation MUST fire

---

### Requirement: REQ-UIR-05 WCAG AA Contrast

All body text against its background MUST meet 4.5:1 contrast ratio. All large text and UI components MUST meet 3:1 contrast ratio. The accent color #F97316 on white MUST be verified at design-token definition time.

#### Scenario: Body text contrast passes AA

- GIVEN `--fg` token on `--bg` in both light and dark themes
- WHEN measured by a contrast checker
- THEN the ratio MUST be ≥ 4.5:1
