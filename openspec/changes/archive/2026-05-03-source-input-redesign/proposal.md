# Proposal: Source Input Redesign

## Intent

Replace the 4-tab plain-text source input (GitHub/GitLab/Local/ZIP) with a modern 2-mode smart input: **Remote** (URL paste with GitHub/GitLab auto-detection) and **Local** (drag-drop zone + file/folder pickers). Fix the `/scans/new` API mismatch where the page sends `sourceUrl`/`sourcePath` instead of `sourceRef`. Unify the two duplicated creation flows (standalone page + sidebar wizard) into a shared `SourceInput` component.

## Scope

### In Scope
- Shared `SourceInput` component with Remote/Local segmented control
- Remote mode: URL paste input with GitHub vs GitLab auto-detection
- Local mode: drag-drop zone accepting folders and ZIP files, with fallback file/folder picker buttons
- Fix `/scans/new` page to send `sourceRef` per the API schema
- Integrate `POST /api/sources` pre-submission validation into the new flow
- Unify sidebar `NewProjectForm` and `/scans/new` page to both use `SourceInput`
- Add `react-dropzone` dependency

### Out of Scope
- Backend pipeline changes — `sourceKind` enum and ingestion logic unchanged
- PAT/token input UI changes (reuse existing)
- `ScanConfig` step 2 redesign
- Cross-platform file paths (Windows drive letters untouched)

## Capabilities

### New Capabilities
- `source-input`: Unified smart source input component — Remote (URL + detection) and Local (drag-drop + pickers) modes, pre-submission validation via `/api/sources`

### Modified Capabilities
None. Backend ingestion contracts (`sourceKind` enum, `sourceRef` string) unchanged. UX is implementation, not spec-level behavior.

## Approach

1. Install `react-dropzone` for drag-and-drop zone.
2. Build `SourceInput` component: segmented control "Remote" | "Local".
   - **Remote**: `<input>` for URL + real-time badge showing detected platform (GitHub/GitLab/Unknown). Detection logic from existing `detectSourceKind()` in `NewProjectForm`.
   - **Local**: Drop zone (accept `.zip`, directories) + two buttons — "Choose Folder" (webkitdirectory input) and "Choose ZIP File" (file input). Auto-detect folder vs .zip from selection.
3. Call `POST /api/sources` on blur/selection to validate before submit.
4. Replace `NewProjectForm` and `/scans/new` page bodies with `SourceInput`.
5. Fix `/scans/new` submit to send `{ sourceType, sourceRef }` instead of `{ sourceType, sourceUrl | sourcePath }`.
6. Keep existing `Tabs` component archive; replace only source-input tabs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `components/source/SourceInput.tsx` | New | Unified smart source input |
| `components/project/NewProjectForm.tsx` | Modified | Reuse SourceInput |
| `app/scans/new/page.tsx` | Modified | Reuse SourceInput, fix API payload |
| `package.json` | Modified | Add react-dropzone |
| `lib/api/schemas/scans.ts` | Unchanged | Validate schema remains correct |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `webkitdirectory` browser support varies | Low | Graceful fallback — folder path manual entry as last resort |
| Drag-drop of large directories freezes UI | Med | Size warning before upload; defer to backend ZIP cap |
| `POST /api/sources` path validation breaks with `assertUnder` on dropped paths | Low | Drop zone gets `webkitRelativePath` from File API; validate server-side |

## Rollback Plan

Revert commit. `NewProjectForm` and `/scans/new` are discrete files — restore from git. `react-dropzone` removal is a single `bun remove`. No DB migration, no API schema changes.

## Dependencies

- `react-dropzone` (npm package, MIT license)

## Success Criteria

- [ ] User sees 2 modes (Remote / Local) instead of 4 tabs
- [ ] Pasting `https://github.com/org/repo` auto-detects GitHub with visual badge
- [ ] Pasting `https://gitlab.com/org/repo` auto-detects GitLab
- [ ] Dragging a folder or `.zip` onto the drop zone populates the input
- [ ] "Choose Folder" and "Choose ZIP File" buttons work on macOS
- [ ] `/scans/new` sends `{ sourceType, sourceRef }` — API returns 201
- [ ] Sidebar wizard and standalone page use the same `SourceInput` component
- [ ] `POST /api/sources` validates locally before scan creation
