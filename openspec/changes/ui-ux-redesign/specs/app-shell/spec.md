# App Shell Specification

## Purpose

Defines the outer chrome: sidebar structure, brand header, nav item rendering, New Scan trigger, and footer.

## Requirements

### Requirement: REQ-UIR-06 Sidebar Provider Structure

The system MUST replace `components/Shell.tsx` with a `SidebarProvider` + `SidebarInset` layout from shadcn. The sidebar MUST be fixed at 220px width with no collapse affordance.

#### Scenario: Sidebar always visible

- GIVEN the app renders any route
- WHEN the layout mounts
- THEN a sidebar element MUST be visible at exactly 220px width
- AND no toggle to hide or collapse the sidebar MUST exist

---

### Requirement: REQ-UIR-07 Brand Header

The sidebar header MUST display the application logo and the label "open-security". Both MUST be present in the DOM.

#### Scenario: Brand renders correctly

- GIVEN any authenticated page
- WHEN the sidebar renders
- THEN the text "open-security" MUST appear inside the sidebar header region

---

### Requirement: REQ-UIR-08 Navigation Items

The sidebar MUST render exactly these nav items in order: Queue, Projects, Posture, Reports, Settings. The active item MUST have `bg-accent/10 text-accent` classes. Inactive items MUST have `text-fg/50` with `hover:text-fg hover:bg-surface-hover`. All nav links MUST carry `aria-current="page"` when active.

#### Scenario: Active item marked

- GIVEN the user is on `/queue`
- WHEN the sidebar nav renders
- THEN the Queue nav item MUST have `aria-current="page"`
- AND MUST apply active color classes

#### Scenario: All five nav items present

- GIVEN any page load
- WHEN the sidebar renders
- THEN exactly five nav items MUST appear: Queue, Projects, Posture, Reports, Settings

---

### Requirement: REQ-UIR-09 New Scan Button

The sidebar MUST contain a "+ New Scan" button that opens the New Scan modal. The button MUST be keyboard reachable and visually distinct.

#### Scenario: Button opens modal

- GIVEN the user clicks "+ New Scan"
- WHEN the click event fires
- THEN the New Scan Dialog MUST open with focus trapped inside

---

### Requirement: REQ-UIR-10 Sidebar Footer

The sidebar MUST display at its bottom: a ThemeToggle button, the application version string (from `package.json`), and a GitHub link. The footer MUST use muted text styling.

#### Scenario: Footer content present

- GIVEN the sidebar renders
- WHEN the footer region is inspected
- THEN the ThemeToggle, a version string, and a GitHub link MUST all be present

---

### Requirement: REQ-UIR-11 Page Footer in SidebarInset

Inside `SidebarInset`, a minimal footer (32px height) MUST appear showing the app version and GitHub link in muted text. This footer MUST NOT appear inside the sidebar panel itself.

#### Scenario: Footer in correct region

- GIVEN any page
- WHEN the DOM is inspected
- THEN the page-level footer MUST be a child of `SidebarInset`, not the sidebar panel
