# source-input Specification

## Purpose

Frontend component for selecting scan source. Unifies sidebar wizard and standalone `/scans/new` page. Replaces 4-tab text input with 2-mode smart input: Remote (URL + platform detection) and Local (drag-drop + pickers). Calls `POST /api/sources` for pre-submission validation. Backend ingestion contracts unchanged.

## Requirements

### Requirement: Mode Selection

The component SHALL present a segmented control with "Remote" (default) and "Local". Switching modes SHALL preserve the URL value when returning to Remote.

#### Scenario: Mode switch preserves state
- GIVEN a URL is entered in Remote mode
- WHEN user switches to Local then back
- THEN the URL input retains its value

### Requirement: Remote URL Input, Detection, and Validation

The system SHALL provide an HTTPS URL text input. On change (debounced 300ms), it MUST detect the platform: `github.com` → "GitHub" badge, `gitlab.com` or host containing `gitlab` → "GitLab", other valid HTTPS → "Unknown host" (submittable), invalid/non-HTTPS → inline error, submit disabled.

On blur (debounced 500ms), the system SHALL call `POST /api/sources` with `{ sourceType, sourceRef }` and show: spinner during call → green checkmark on `{ valid: true }` → server `reason` inline on failure. On network error, fail-open with "Could not validate. Submit anyway?".

#### Scenario: GitHub URL pasted and validated
- GIVEN user pastes `https://github.com/org/repo`
- THEN "GitHub" badge appears within 300ms
- AND on blur, validation spinner then green checkmark appear

#### Scenario: Invalid URL
- GIVEN user types `not-a-url`
- THEN inline error "Enter a valid HTTPS URL" and submit disabled

#### Scenario: API rejection
- GIVEN a non-existent local path
- WHEN validation returns `{ valid: false, reason: "Path does not exist" }`
- THEN reason displayed inline and submit disabled

### Requirement: Local Drag-Drop Zone

In Local mode, the system SHALL render a drag-drop zone. `.zip` files and folders SHALL be accepted — name displayed, validation triggered. Non-zip, non-directory drops SHALL flash red with "Only .zip files and folders accepted" and preserve prior selection.

#### Scenario: ZIP or folder dropped
- GIVEN user drops `project.zip` or a folder
- THEN item name displayed and validation runs

#### Scenario: Invalid file rejected
- GIVEN user drops `archive.tar.gz`
- THEN zone flashes red with rejection, prior selection preserved

### Requirement: File and Folder Pickers

"Choose Folder" (`<input webkitdirectory>`) and "Choose ZIP File" (`<input accept=".zip">`) buttons SHALL be provided. When `webkitdirectory` unsupported, fall back to manual path text input with "Enter folder path" label. Folders exceeding 200 MB (per API) SHALL show non-blocking warning "Directory exceeds 200 MB. Scans may be slow."

#### Scenario: Folder picker
- GIVEN user clicks "Choose Folder"
- WHEN native dialog selects a directory
- THEN name displayed and validation runs

#### Scenario: webkitdirectory fallback
- GIVEN browser lacks support
- THEN manual path input shown instead of picker button

### Requirement: Correct Scan Payload

On submit, the frontend SHALL send `{ sourceType, sourceRef }`. It SHALL NOT send `sourceUrl` or `sourcePath`.

#### Scenario: Valid scan submission
- GIVEN validated GitHub URL
- WHEN submitted
- THEN `POST /api/scans` receives `{ sourceType: "github", sourceRef: "https://github.com/org/repo" }` → 201

### Requirement: Single Component in Both Contexts

`SourceInput` SHALL be the sole source UI in `NewProjectForm` and `/scans/new`. Both contexts SHALL behave identically.

#### Scenario: Consistent behavior
- GIVEN same URL pasted in sidebar wizard and standalone page
- THEN both show identical badge, validation, and errors

### Requirement: Accessibility

All controls SHALL have accessible labels. Segmented control SHALL support arrow keys. Drop zone SHALL use `aria-live`. Errors SHALL use `role="alert"`. All controls SHALL be in natural Tab order.

#### Scenario: Keyboard navigable
- GIVEN focus on Remote/Local control
- WHEN Tab pressed
- THEN focus moves to next control

#### Scenario: Screen reader error
- GIVEN validation fails
- WHEN error renders
- THEN `role="alert"` announces without focus change
