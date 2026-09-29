# Configuration

open-security stores all configuration in a SQLite `config` table (key: `app-config`). The Settings UI (`/config`) provides a visual editor. The config can also be edited directly in `.obt/config.json` (legacy format, auto-migrated to SQLite on first read).

## Config schema

```typescript
{
  models: {                              // Model assignments per pipeline stage
    'llm-scan'?: string                   // e.g. "cli:claude:claude-sonnet-4-5"
    'validate'?: string                   // e.g. "api:openai:gpt-4o-mini"
    'filter'?: string
    'patch'?: string
  },
  providers: {                           // API keys (never returned in API responses)
    anthropicKey?: string
    openaiKey?: string
    googleKey?: string
    ollamaKey?: string
  },
  theme: 'light' | 'dark'                // UI theme (default: 'dark')
  workerMemoryMb: number                  // Memory limit for worker (256-8192, default: 2048)
  stage2Concurrency: number               // Max concurrent LLM calls (1-16, default: 4)
}
```

## Model strings

Models are assigned per pipeline stage using a string identifier:

```
cli:<agentId>              → Uses agent's default model
cli:<agentId>:<modelId>    → Specific model (e.g. "cli:claude:claude-sonnet-4-5")
api:<providerId>:<modelId> → API SDK model (e.g. "api:anthropic:claude-sonnet-4-5")
```

If a stage has no model configured, the pipeline skips that stage's LLM calls and falls back to the `llm-scan` provider.

## Per-project model snapshot

When a project is created (`POST /api/scans` without `parentScanId`), the current `models` config is snapshotted as JSON into `projects.models_config`. This provides:
- **Audit trail**: See which models were configured when the project was scanned
- **UI info**: The `ModelsInfoCard` in scan creation and sidebar shows the snapshot

The snapshot is NOT updated when global config changes — it's a point-in-time record.

## Policies

Three YAML policy files in `policies/` control scan behavior. All are loaded via the Zod-validated policy loader (`lib/policies/loader.ts`).

### `policies/fp-filter.yaml`

False-positive filter rules. Each rule specifies a glob pattern — findings in matching paths are dropped.

```yaml
rules:
  - id: skip-test-files
    match_path: "**/*.test.*"
    action: filter

  - id: skip-fixture-files
    match_path: "**/fixtures/**"
    action: filter

  - id: skip-mock-files
    match_path: "**/__mocks__/**"
    action: filter
```

**Glob syntax**:
- `**` — matches zero or more path segments
- `*` — matches within a single segment (no `/`)
- Literal `.` is escaped (matches literal dot)

**Adding a rule**: Add a YAML entry with a unique `id`, a `match_path` glob, and `action: filter`.

### `policies/severity.yaml`

Maps CVSS scores to severity levels and report thresholds.

```yaml
thresholds:
  critical: 9.0
  high: 7.0
  medium: 4.0
  low: 0.1
cvss_map:
  sqli: "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
  xss: "AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:L/A:N"
```

### `policies/confidence.yaml`

Confidence thresholds for finding processing.

```yaml
minimum_report: 0.3      # Minimum confidence to include in reports
minimum_validate: 0.5    # Minimum confidence to send for validation
minimum_patch: 0.7       # Minimum confidence to synthesize a patch
auto_fp_below: 0.2       # Auto-mark as false positive below this threshold
```

## Workspace

The workspace lives in `.obt/` at the project root. Configurable via environment:

| Variable | Default | Description |
|----------|---------|-------------|
| `OBT_ROOT` | `.obt/` | Workspace root directory |

### `.obt/` structure

```
.obt/
  db.sqlite              SQLite database (all tables)
  config.json            Legacy config format (auto-migrated to SQLite)
  projects/
    {projectId}/
      scans/
        {scanId}/
          source/         Cloned/copied source code
          reports/
            report.json
            report.md
            report.sarif
            report.csv
          pocs/           Proof-of-concept scripts (Stage 5)
```

**Important**: Never hardcode `.obt/` paths. Use helpers from `lib/config/workspace.ts`:
```typescript
import { scanDir, reportsDir, projectDir } from '@/lib/config/workspace'
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OBT_ROOT` | No | Workspace root (default: `.obt/`) |

API keys are stored in the config, not environment variables (local-first design).

## Config API

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/config` | `GET` | None | Read public config (keys masked) |
| `/api/config` | `PUT` | None | Update config (keys accepted, never returned) |

See [API Reference](api-reference.md) for request/response formats.
