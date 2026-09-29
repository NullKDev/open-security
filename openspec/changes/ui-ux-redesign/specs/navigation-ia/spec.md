# Navigation Information Architecture Specification

## Purpose

Defines routing structure, redirects, Settings sub-navigation, New Scan modal, Queue redesign, and scan progress layout.

## Requirements

### Requirement: REQ-UIR-12 Route Redirects

`next.config.ts` MUST define permanent redirects: `/config` → `/settings/providers` and `/repos` → `/settings/repos`. Both MUST return HTTP 308 or equivalent Next.js permanent redirect.

#### Scenario: Legacy /config redirects

- GIVEN a user navigates to `/config`
- WHEN Next.js processes the request
- THEN the browser MUST land on `/settings/providers`

#### Scenario: Legacy /repos redirects

- GIVEN a user navigates to `/repos`
- WHEN Next.js processes the request
- THEN the browser MUST land on `/settings/repos`

---

### Requirement: REQ-UIR-13 Settings Sub-Navigation

The `/settings` route MUST host sub-pages: `/settings/providers`, `/settings/repos`, `/settings/webhook`, `/settings/policies`, `/settings/integrations`. The `/settings` index MUST render a language toggle (EN/ES).

#### Scenario: Sub-pages reachable

- GIVEN the user navigates to `/settings/providers`
- WHEN the page renders
- THEN the providers configuration UI MUST appear (content unchanged from former `/config`)

#### Scenario: Language toggle in settings only

- GIVEN the user is on `/settings`
- WHEN the page renders
- THEN an EN/ES language toggle MUST be present
- AND no language toggle MUST appear in the sidebar header or any other route

---

### Requirement: REQ-UIR-14 Findings Route Removed

`/findings` MUST NOT appear in the sidebar navigation. The Dismissed findings tab MUST be accessible from `/queue?tab=dismissed` or as a tab within the Queue page.

#### Scenario: /findings absent from nav

- GIVEN the sidebar renders
- WHEN all nav items are enumerated
- THEN no item linking to `/findings` MUST appear

#### Scenario: Dismissed tab reachable from Queue

- GIVEN the user is on `/queue`
- WHEN they click the "Dismissed" tab
- THEN dismissed findings MUST render within the Queue page

---

### Requirement: REQ-UIR-15 New Scan Modal

The New Scan modal MUST use shadcn `Dialog`. It MUST implement two steps: Step 1 collects source URL or local path plus project name; Step 2 collects scan configuration (intensity, model, git history, dependency scan toggle). Submission MUST `POST /api/scans` and redirect to `/scans/[id]` on success.

#### Scenario: Step progression

- GIVEN the New Scan Dialog is open on Step 1
- WHEN the user fills in source and project name and clicks Next
- THEN Step 2 MUST render with scan config fields

#### Scenario: Accessible dialog

- GIVEN the dialog is open
- WHEN it renders
- THEN focus MUST be trapped inside the dialog
- AND pressing Escape MUST close the dialog
- AND `aria-modal="true"` MUST be set

#### Scenario: Successful submission redirects

- GIVEN valid inputs in both steps
- WHEN the user submits
- THEN `POST /api/scans` MUST be called
- AND on 2xx response the browser MUST navigate to `/scans/[id]`

---

### Requirement: REQ-UIR-16 Queue Page Redesign

The Queue page MUST render two tabs: "Open" (default) and "Dismissed". It MUST display severity summary chips at the top (counts for critical/high/medium/low/info). It MUST include a filter bar with severity, project, hasPatch, and KEV-only filters. Pagination MUST use shadcn `Pagination` (replacing any "Load more" button). An empty state MUST show an icon, a message, and a CTA.

#### Scenario: Default tab is Open

- GIVEN the user navigates to `/queue`
- WHEN the page renders
- THEN the "Open" tab MUST be active and show open findings

#### Scenario: Severity chips reflect counts

- GIVEN findings exist with mixed severities
- WHEN the Queue page renders
- THEN each severity chip (critical/high/medium/low/info) MUST display a count

#### Scenario: Filter reduces list

- GIVEN the filter bar shows severity = "critical"
- WHEN the user selects it
- THEN only critical findings MUST appear in the list

#### Scenario: Empty state renders correctly

- GIVEN no findings match the active filters
- WHEN the list renders
- THEN an icon, a descriptive message, and a CTA MUST be visible

---

### Requirement: REQ-UIR-17 Scan Progress Two-Column Layout

`/scans/[id]` MUST render a two-column layout via shadcn `ResizablePanelGroup`. The left panel (default 40%) MUST show the 5-stage pipeline and live findings counter. The right panel (default 60%) MUST show the LLM log stream. A sticky header MUST show scan title, status badge, cost display, and export button.

#### Scenario: Panels render in two columns

- GIVEN the user opens `/scans/[id]`
- WHEN the page renders
- THEN two resizable panels MUST appear side by side

#### Scenario: Live finding counter updates

- GIVEN a scan is in progress and new findings arrive via SSE
- WHEN each finding event is processed
- THEN the finding counter badge in the left panel MUST increment without page reload

#### Scenario: Sticky header visible on scroll

- GIVEN the log stream is long enough to require scrolling
- WHEN the user scrolls down
- THEN the header (title, status, cost, export) MUST remain visible at the top
