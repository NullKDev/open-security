# Tasks: Source Input Redesign

## Phase 1: Foundation — Dependency & Shared Types

- [x] 1.1 Install `react-dropzone@^15.0.0` in `package.json` via `bun add react-dropzone`
- [x] 1.2 Create shared `SourceType` and `SourceData` types in `lib/types/source.ts` (moved from `NewProjectForm.tsx`'s local `SourceKind`)

## Phase 2: Core — SourceInput Component & Sub-modes

- [x] 2.1 Create `components/source/SourceInput.tsx` — controlled component with 2-segment toggle (Remote/Local), lifts `onSourceChange({ sourceType, sourceRef })`, preserves URL when switching modes
- [x] 2.2 Create `components/source/RemoteMode.tsx` — URL `<input>` with 300ms debounced `detectSourceKind()` (hostname-based: `github.com`→github, `gitlab` in hostname→gitlab, valid HTTPS→github, invalid→null), shows platform badge; validation on blur via hook
- [x] 2.3 Create `components/source/LocalMode.tsx` — `react-dropzone` drop zone accepting `.zip` and directories (flash red on invalid), "Choose Folder" button via hidden `<input webkitdirectory>` with manual path fallback, "Choose ZIP File" button via `<input accept=".zip">`
- [x] 2.4 Create `components/source/useSourceValidation.ts` — hook calling `POST /api/sources` on blur/select, returns `{ valid, reason, validating }`; debounced 500ms, shows spinner→checkmark→reason, fail-open on network error

## Phase 3: Integration — Replace Existing Flows

- [x] 3.1 Modify `components/project/NewProjectForm.tsx` — remove 4-tab Tabs and inline `detectSourceKind`, import SourceInput, pass `onSourceChange` → local state, submit sends `{ name, sourceKind: sourceType, sourceRef }`
- [x] 3.2 Modify `app/scans/new/page.tsx` — replace 4-tab Tabs and `isValidUrl()` with SourceInput, fix submit payload from `sourceUrl`/`sourcePath` to `sourceRef`, wire navigation on 201

## Phase 4: Testing — Unit & Integration

- [x] 4.1 Write `components/source/__tests__/SourceInput.test.tsx` — test mode switch preserves URL, Remote/Local render correct child, `onSourceChange` fires on input
- [x] 4.2 Write `components/source/__tests__/RemoteMode.test.tsx` — table-driven `detectSourceKind` (github.com→github, gitlab.com→gitlab, self-hosted→gitlab, valid→github, invalid→null), badge appears within 300ms, empty input shows no badge
- [x] 4.3 Write `components/source/__tests__/useSourceValidation.test.ts` — mock fetch, assert POST body `{ sourceType, sourceRef }`, assert `{ valid: true }` returns checkmark, `{ valid: false, reason }` shows reason, network error → fail-open
- [x] 4.4 Update `tests/unit/pages/scans-new.test.tsx` — replace 4-tab assertions with 2-mode SourceInput assertions, verify POST sends `sourceRef` not `sourceUrl`, verify 201 → route push
- [x] 4.5 Write `components/project/__tests__/NewProjectForm.test.tsx` — verify SourceInput renders inside form, submit sends `{ sourceKind, sourceRef }`, project name preserved
- [x] 4.6 Write `components/source/__tests__/LocalMode.test.tsx` — test drop zone rendering, manual path input, ZIP picker, drag-over visual state, 200 MB warning (display/absent), webkitdirectory fallback, ARIA roles/labels, keyboard accessibility (Enter/Space), change selection clear, drag error on invalid file

## Phase 5: Accessibility & Cleanup

- [x] 5.1 Add `role="radiogroup"` + arrow-key nav to segmented control, `aria-live="polite"` on drop zone, `role="alert"` on validation errors, `<label>` association on all inputs
- [x] 5.2 Verify all spec scenarios pass: mode-switch-preserve, GitHub-paste-badge, invalid-URL-disabled, valid/invalid file drop, webkitdirectory fallback, screen reader error announcement

## Phase 6: Redesign — Remove Tabs, Auto-Detect Source

- [x] 6.1 Fix folder drop bug in `LocalMode.tsx` — use `getFilesFromEvent` with `DataTransferItem.webkitGetAsEntry()` for proper directory entry traversal
- [x] 6.2 Remove all tabs from `SourceInput.tsx` — replace Remote/Local segmented control and Folder/ZIP sub-toggle with auto-detection (idle → url | folder | zip)
- [x] 6.3 Add optional `password` field to `SourceData` in `lib/types/source.ts` for encrypted ZIP support
- [x] 6.4 Create `components/source/useZipDetection.ts` — hook that checks ZIP encryption via local file header GPBF bit 0
- [x] 6.5 Update `LocalMode.tsx` to handle both folder and ZIP without a `mode` prop — both picker buttons always visible, drop zone accepts both
- [x] 6.6 Rewrite `SourceInput.tsx` — no tabs, always-visible URL input + drop zone, auto-detect from user action, clear button
- [x] 6.7 Update all tests: `SourceInput.test.tsx` (no-tab assertions), `LocalMode.test.tsx` (no mode prop), `NewProjectForm.test.tsx`, `scans-new.test.tsx`, new `useZipDetection.test.ts` (8 tests)
- [x] 6.8 Verify: `bunx tsc --noEmit` → 0 errors, `bunx vitest run` → 594 tests pass, 0 failures

## Phase 7: Remote Repository Access Detection

- [x] 7.1 Backend — Add `git ls-remote --heads` check to `POST /api/sources` for github/gitlab types, with `noAccess: true` + `suggestion` on auth failure
- [x] 7.2 Hook — Add `noAccess: boolean` and `suggestion: string | null` to `ValidationState`, wire `setNoAccess`/`setSuggestion` from API response
- [x] 7.3 UI — Add `noAccess`/`suggestion` props to `RemoteMode`, render suggestion in info tone below error when repo is inaccessible
- [x] 7.4 Wire — Pass `noAccess`/`suggestion` from `SourceInput` to `RemoteMode`
- [x] 7.5 Test — Mock `execSync` in `tests/api/sources.test.ts`, add `noAccess=true` test case
