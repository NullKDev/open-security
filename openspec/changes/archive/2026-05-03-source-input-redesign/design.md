# Design: Source Input Redesign

## Technical Approach

Replace 4-tab plain-text input with a 2-mode controlled component (`SourceInput`). Remote mode: URL paste with hostname-based auto-detection (GitHub/GitLab). Local mode: `react-dropzone` drop zone (`.zip`) + hidden `webkitdirectory` input for folders, with fallback file/folder picker buttons. Pre-submission validation via `POST /api/sources`. Unify `/scans/new` page and sidebar `NewProjectForm` to consume the same component. Fix API payload — send `sourceRef` instead of `sourceUrl`/`sourcePath`.

## Architecture Decisions

| Decision | Choice | Rejected | Why |
|----------|--------|----------|-----|
| Drag-drop lib | react-dropzone (~15KB) | Native HTML5 DnD | Consistent cross-browser drop zone behavior, built-in ARIA attributes, TypeScript types, active state CSS class toggle |
| Folder input | `<input webkitdirectory>` hidden + button trigger | Drag-drop folders via react-dropzone `getFilesFromEvent` | webkitdirectory has broader macOS/Linux browser support; kept as controlled click-to-pick, not dropped |
| Mode selector | 2-segment custom control (Remote/Local) | Reuse existing `Tabs` with 2 tabs | UI intent matches iOS-style segmented control (mutually exclusive, binary choice); Tabs component has heavy role="tablist" semantics inappropriate for this |
| Auto-detection | Hostname parsing via `new URL().hostname` (github.com / *.gitlab.*) | Regex patterns from `lib/sources/` | Detection for UI badge is visual hint, not security boundary; hostname check is fast, handles self-hosted GitLab (`gitlab.internal.co`) |
| Validation timing | On URL blur + on file/folder selection | On every keystroke | Avoids flooding `/api/sources` during typing; URL validation is debounced while typing, full POST fires on blur |
| State lift | `SourceInput` is controlled — parent passes `onSourceChange({ sourceType, sourceRef })` | Internal state + imperative getter | Follows React controlled pattern used by existing `NewProjectForm` and `NewScanPage` |

## Data Flow

```
SourceInput ──onSourceChange──→ Parent Form (Sidebar | /scans/new)
     │                                    │
     ├─ URL blur / file select ──→ POST /api/sources (validate)
     │    │                              │
     │    └── { valid, reason } ←───────┘
     │
     └─ Parent submit ────────→ POST /api/scans { sourceType, sourceRef, projectName }
                                      │
                                      └──→ 201 { id, projectId, status }
```

**Fix**: Currently `/scans/new/page.tsx` sends `sourceUrl` / `sourcePath` (lines 57–59). API expects `sourceRef` per `CreateScanSchema`. Change to `{ sourceType, sourceRef: inputValue }`. The `Sidebar.tsx` wizard already sends `sourceRef` correctly (line 69).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `components/source/SourceInput.tsx` | **Create** | Main component — segmented control, delegates to RemoteMode/LocalMode, exposes `onSourceChange` callback |
| `components/source/RemoteMode.tsx` | **Create** | URL input + `detectSourceKind()` badge (GitHub/GitLab/Unknown) + inline validation feedback |
| `components/source/LocalMode.tsx` | **Create** | react-dropzone zone for `.zip` + "Choose Folder" (webkitdirectory) + "Choose ZIP File" buttons |
| `components/source/useSourceValidation.ts` | **Create** | Hook — calls `POST /api/sources` on blur/select, returns `{ valid, reason }` |
| `components/project/NewProjectForm.tsx` | **Modify** | Replace 4-tab Tabs + text input (lines 65–121) with `<SourceInput>`. Keep project name input and submit button. Remove `detectSourceKind` (moved to RemoteMode). |
| `app/scans/new/page.tsx` | **Modify** | Replace 4-tab Tabs + tabs array (lines 81–180) with `<SourceInput>`. Fix submit payload: `sourceUrl`/`sourcePath` → `sourceRef`. Remove `isValidUrl` and inline validation. |
| `package.json` | **Modify** | Add `"react-dropzone": "^14.x"` to dependencies |

## Interfaces

```typescript
// components/source/SourceInput.tsx
type SourceType = "github" | "gitlab" | "local" | "zip";

interface SourceInputProps {
  onSourceChange: (data: { sourceType: SourceType; sourceRef: string }) => void;
  initialSourceType?: SourceType;
  initialSourceRef?: string;
  className?: string;
}

// Internal: useSourceValidation hook
function useSourceValidation(sourceType: SourceType, sourceRef: string):
  { valid: boolean | null; reason: string | null; validating: boolean }
```

**Detection function** (moved from `NewProjectForm.tsx` line 20 to `RemoteMode.tsx`):
```typescript
function detectSourceKind(url: string): "github" | "gitlab" | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "github.com") return "github";
    if (u.hostname.includes("gitlab")) return "gitlab";
    return "github"; // default for any valid unknown URL
  } catch { return null; }
}
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `detectSourceKind()` | Table-driven — valid GitHub/GitLab/self-hosted/plain URL/invalid string |
| Unit | `SourceInput` mode switching | Render, click Remote/Local segments, assert correct child renders |
| Unit | `RemoteMode` URL input | Type URL, verify badge text changes (GitHub/GitLab/No badge for invalid) |
| Unit | `useSourceValidation` hook | Mock fetch, assert POST body matches schema, assert valid/reason states |
| Integration | `NewScanPage` renders with SourceInput | Replace existing `scans-new.test.tsx` tests — verify mode switching, submit payload contains `sourceRef` not `sourceUrl` |
| Integration | `NewProjectForm` sidebar wizard | Verify `onSubmit` receives `{ sourceKind, sourceRef }` |

## Migration / Rollout

No migration required. No DB schema changes. No API contract changes. `react-dropzone` added as single new dependency. Rollback: `git revert` + `bun remove react-dropzone`.

## Open Questions

- [ ] Should URL auto-detection use `lib/sources/github.ts` `GITHUB_URL_PATTERN` regex for stricter matching (requires `owner/repo` path), or stay with lenient hostname check? Current design uses lenient hostname since detection is UI hint, not validation gate.
