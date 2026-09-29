# Internationalization Specification

## Purpose

Defines next-intl setup, message catalog structure, locale persistence, and language switching behavior.

## Requirements

### Requirement: REQ-UIR-18 next-intl Integration

The system MUST install and configure `next-intl` for the Next.js 16 App Router. Server components MUST use `next-intl/server`. Client components MUST use the `useTranslations` hook. The default locale MUST be `en`.

#### Scenario: Server component uses next-intl/server

- GIVEN a server component that renders a nav label
- WHEN the page renders
- THEN the label MUST come from the `en` message catalog via `next-intl/server`, not a string literal

#### Scenario: Client component uses useTranslations

- GIVEN a client component with a button label
- WHEN rendered
- THEN the label MUST be sourced from `useTranslations` with the active locale

---

### Requirement: REQ-UIR-19 Message Catalog Coverage

Message files `messages/en.json` and `messages/es.json` MUST contain keys for: all nav labels, all page titles, all empty state messages, all error messages, all button labels, and all form labels. Zero JSX string literals for user-visible text are permitted outside these files.

#### Scenario: Nav labels translated

- GIVEN the locale is set to `es`
- WHEN the sidebar renders
- THEN all five nav labels MUST appear in Spanish using values from `messages/es.json`

#### Scenario: No hardcoded strings in JSX

- GIVEN all files under `app/` and `components/`
- WHEN statically analyzed
- THEN no user-visible string literal MUST appear in JSX outside translation catalog calls

---

### Requirement: REQ-UIR-20 Language Switch in Settings Only

A language toggle (EN/ES) MUST appear exclusively on the `/settings` page. Selecting a language MUST immediately update all visible UI strings. The selected locale MUST persist across page navigations and reloads.

#### Scenario: Toggle only in /settings

- GIVEN any page other than `/settings`
- WHEN the page renders
- THEN no language switcher MUST appear in the UI

#### Scenario: Locale persists across navigation

- GIVEN the user switches to Spanish on `/settings`
- WHEN they navigate to `/queue`
- THEN all UI strings on `/queue` MUST render in Spanish
