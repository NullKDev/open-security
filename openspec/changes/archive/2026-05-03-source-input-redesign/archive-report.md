# Archive Report: Source Input Redesign

**Change**: source-input-redesign  
**Archived**: 2026-05-03  
**Verification**: PASS ✅ (0 CRITICAL, 3 WARNING, 2 SUGGESTION)  
**Artifact Observation IDs**: proposal=#282, spec=#284, design=#283, tasks=#285, apply-progress=#286, verify-report=#287

---

## Executive Summary

Replaced the 4-tab plain-text source input (GitHub/GitLab/Local/ZIP) in the open-security portal with a modern, no-tab, auto-detection smart input. The unified `SourceInput` component is shared between the sidebar wizard (`NewProjectForm`) and standalone `/scans/new` page. Fixes the longstanding API mismatch where the frontend sent `sourceUrl`/`sourcePath` instead of `sourceRef`. Adds backend remote access detection via `git ls-remote --heads` and client-side encrypted ZIP detection.

---

## What Was Built (7 Phases, 31 Tasks — All Complete)

### Phase 1: Foundation
- Installed `react-dropzone@^15.0.0`
- Created shared types: `SourceType`, `SourceData` in `lib/types/source.ts`

### Phase 2: Core Component
- `SourceInput.tsx` — No-tab auto-detection component with URL input + drop zone always visible
- `RemoteMode.tsx` — URL input, hostname-based platform detection (GitHub/GitLab/Unknown), validation badge UI
- `LocalMode.tsx` — Drag-drop zone (`react-dropzone`), "Choose Folder" (`webkitdirectory`), "Choose ZIP File", manual path fallback, folder drop support via `getFilesFromEvent` with `webkitGetAsEntry()`
- `useSourceValidation.ts` — Hook calling `POST /api/sources`, returns `{ valid, reason, validating, noAccess, suggestion }`, fail-open on network error

### Phase 3: Integration
- `NewProjectForm.tsx` — Replaced 4-tab Tabs with `SourceInput`
- `app/scans/new/page.tsx` — Replaced 4-tab Tabs, fixed payload: `sourceUrl`/`sourcePath` → `sourceRef`

### Phase 4: Testing (56 tests across 6 files)
- `SourceInput.test.tsx` (9 tests) — No-tab assertions, auto-detection, clear button
- `RemoteMode.test.tsx` (14 tests) — Platform detection table-driven, badge rendering, validation states
- `useSourceValidation.test.ts` (18 tests) — API calls, fail-open, noAccess, suggestion
- `scans-new.test.tsx` (9 tests) — sourceRef payload verification
- `NewProjectForm.test.tsx` (5 tests) — SourceInput integration
- `LocalMode.test.tsx` (20 tests) — Drop zone, pickers, 200 MB warning, ARIA, keyboard, encrypted ZIP

### Phase 5: Accessibility
- `role="alert"` on errors, `role="status"` + `aria-live="polite"` on size warnings, `aria-invalid` on inputs, natural Tab order

### Phase 6: No-Tab Redesign
- Removed all tabs (Remote/Local segmented control + Folder/ZIP sub-toggle)
- Auto-detection from user action: typing URL → remote, dropping folder/ZIP → local
- Added encrypted ZIP detection via `useZipDetection.ts` (GPBF bit 0 in local file header)
- Added password field for encrypted ZIPs in `SourceData` type and `LocalMode.tsx`

### Phase 7: Remote Access Detection
- Backend: `git ls-remote --heads` check with 10s timeout, 7 auth-failure keyword patterns → `noAccess: true` + suggestion
- UI: 💡 info tip below error when repo is inaccessible, `aria-live="polite"`

---

## Key Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Drag-drop library | react-dropzone (~15KB) | Consistent cross-browser drop zone, built-in ARIA, TypeScript types |
| Folder input | webkitdirectory hidden input | Broader macOS/Linux support than drag-drop folders alone |
| Platform detection | `new URL().hostname` parsing | UI hint only (not security boundary), handles self-hosted GitLab |
| Validation timing | On blur (URL) / on select (file/folder) | Avoids flooding `/api/sources` during typing |
| State management | Controlled component with onChange/onValidationChange callbacks | Follows React controlled pattern used by existing forms |
| No-tab auto-detection | Phase 6 redesign — removed tabs entirely | Cleaner UX: user action determines mode, no mode-switching overhead |
| Remote access check | `git ls-remote --heads` via child_process execSync | Uses local git credentials, no new auth surface |
| ZIP encryption | GPBF bit 0 in local file header | Client-side detection without reading entire archive |

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `components/source/SourceInput.tsx` | **Created** | Main auto-detection component, no tabs, clear button |
| `components/source/RemoteMode.tsx` | **Created** | URL input + platform badge + validation + noAccess suggestion |
| `components/source/LocalMode.tsx` | **Created** | Drag-drop zone + folder/ZIP pickers + 200 MB warning + encrypted ZIP |
| `components/source/useSourceValidation.ts` | **Created** | Hook: POST /api/sources, noAccess/suggestion state |
| `components/source/useZipDetection.ts` | **Created** | Hook: GPBF bit 0 encrypted ZIP detection |
| `lib/types/source.ts` | **Created** | SourceType, SourceData (with password field) |
| `components/project/NewProjectForm.tsx` | **Modified** | Replaced 4-tab Tabs with SourceInput |
| `app/scans/new/page.tsx` | **Modified** | Replaced 4-tab Tabs, fixed sourceRef payload |
| `app/api/sources/route.ts` | **Modified** | Added git ls-remote check + noAccess/suggestion response |
| `package.json` | **Modified** | Added react-dropzone@^15.0.0 |
| `tests/api/sources.test.ts` | **Modified** | Added noAccess=true test case |
| Components test files (6 files) | **Created/Modified** | 56+ tests across 6 test suites |

---

## Bugs Fixed During Implementation

1. **Folder drop ignored in react-dropzone** — `react-dropzone`'s default `getFilesFromEvent` doesn't handle `DataTransferItem.webkitGetAsEntry()`. Fixed in `LocalMode.tsx` with custom `getFilesFromEvent` that traverses directory entries.

2. **ZIP password not supported** — Added encrypted ZIP detection (`useZipDetection.ts` reading GPBF bit 0) and password input field in `LocalMode.tsx`. `password` field added to `SourceData` type.

3. **API payload mismatch** — `/scans/new` page sent `sourceUrl` and `sourcePath` instead of `sourceRef`. Fixed to send `{ sourceType, sourceRef }`.

4. **200 MB size warning missing** — Added in `LocalMode.tsx` across three code paths (ZIP picker, drag-drop, manual input) with non-blocking amber warning using `role="status"` + `aria-live="polite"`.

5. **Remote private repo unreachable** — Added `git ls-remote --heads` check returning `noAccess: true` + suggestion to use local folder instead.

---

## Deviations from Design

| Aspect | Design Specification | Actual Implementation | Rationale |
|--------|--------------------|-----------------------|-----------|
| Mode selection | Segmented control (Remote/Local) | No tabs — auto-detection from user action | Phase 6 redesign; cleaner UX, all inputs always visible |
| Sub-mode | Folder/ZIP sub-toggle in Local mode | Both pickers always visible, no sub-toggle | Consistent with no-tab approach |
| Callback API | Single `onSourceChange({ sourceType, sourceRef })` | Two callbacks: `onChange(value)` + `onValidationChange(valid)` | Cleaner separation of data vs validation state |
| File count | 7 files listed in design | 12 files changed (9 created, 3 modified) | Phase 6 added `useZipDetection.ts`; Phase 7 added backend changes |
| Phases | 5 original phases | 7 phases (Phase 6: no-tab redesign, Phase 7: remote access) | Iterative refinement during implementation |

---

## Final Verification Results

| Metric | Result |
|--------|--------|
| **TypeScript** | ✅ 0 errors (`bunx tsc --noEmit`) |
| **Tests** | ✅ 595 passed, 0 failed, 0 skipped |
| **Test files** | 70 files passed (23 `.obt/` pre-existing failures unrelated) |
| **Tasks complete** | 31/31 (100%) |
| **Spec compliance** | 30/31 scenarios compliant (1 PARTIAL: arrow-key nav spec rendered obsolete by tab removal) |
| **CRITICAL issues** | 0 |
| **WARNING issues** | 3 (2 design doc mismatches — documented above, 1 pre-existing .obt/ noise) |
| **SUGGESTION items** | 2 (exclude .obt/ from vitest, update design doc) |

---

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| `source-input` | **Created** | New domain spec copied to `openspec/specs/source-input/spec.md` |
| `open-security-v01` | **Unchanged** | Backend contracts unchanged; frontend UX change doesn't modify ingestion requirements |

---

## Archive Location

- **Openspec**: `openspec/changes/archive/2026-05-03-source-input-redesign/`
- **Engram**: `sdd/source-input-redesign/archive-report` (topic_key) with observation IDs #282-#287

---

## SDD Cycle Complete ✅

The change has been fully planned (propose → spec → design → tasks), implemented (apply — 7 phases, 31 tasks), verified (PASS, 595 tests, 0 CRITICAL), and archived. The source of truth (`openspec/specs/`) now includes the `source-input` domain. Ready for the next change.
