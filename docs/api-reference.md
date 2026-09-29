# API Reference

All API routes are under `/api/`. Responses follow a standard envelope format.

## Response envelope

```typescript
// Success
{ "success": true, "data": T }

// Paginated
{ "success": true, "data": T[], "meta": { "total": number, "cursor": string? } }

// Error
{ "success": false, "error": { "code": string, "message": string } }
```

## Common error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_INPUT` | 400 | Zod validation failed on request body/params |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## Scans

### `POST /api/scans`

Start a new scan. Creates a project (if not using a parent scan) and immediately begins the pipeline.

**Request**:
```json
{
  "sourceType": "github",          // "github" | "gitlab" | "local" | "zip"
  "sourceRef": "https://github.com/org/repo",
  "projectName": "my-project",     // optional — derived from sourceRef if omitted
  "scanMode": "standard",          // optional — "quick" | "standard" | "intermediate" | "paranoid"
  "prompt": "Focus on auth module",// optional — free-form LLM focus prompt
  "parentScanId": "uuid"           // optional — rescan, inherits project + source
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "scan-uuid",
    "projectId": "project-uuid",
    "project": {
      "modelsConfig": "{\"llm-scan\":\"cli:claude:claude-sonnet-4-5\"}"
    },
    "version": 1,
    "parentId": null,
    "status": "running"
  }
}
```

### `GET /api/scans`

List all scans across all projects. Paginated with cursor-based pagination.

**Query params**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 10 | Items per page |
| `cursor` | string | — | Base64-encoded offset for next page |

**Response** (200):
```json
{
  "success": true,
  "data": [/* ScanDTO[] */],
  "meta": { "total": 42, "cursor": "NQ==" }
}
```

### `GET /api/scans/:id`

Get a single scan with its aggregated finding counts.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "scan-uuid",
    "projectId": "project-uuid",
    "scanMode": "standard",
    "status": "done",
    "stage": "patch",
    "version": 1,
    "findings": { "critical": 2, "high": 5, "medium": 12, "low": 3, "info": 1 },
    "startedAt": "2026-05-03T12:00:00Z",
    "finishedAt": "2026-05-03T12:15:00Z",
    "modelsUsed": "{\"llm-scan\":\"cli:claude:claude-sonnet-4-5\"}"
  }
}
```

### `DELETE /api/scans/:id`

Cancel a running scan.

**Response** (200): `{ "success": true, "data": null }`

### `GET /api/scans/:id/stream`

SSE stream of scan progress events. Uses Server-Sent Events protocol.

**Headers**: `Content-Type: text/event-stream`

**Event types** (each line is `data: <JSON>\n\n`):
```
data: {"type":"stage","stage":"prep","message":"Preparing workspace"}
data: {"type":"progress","message":"Cloning repository..."}
data: {"type":"thinking","text":"Analyzing the codebase..."}
data: {"type":"finding","finding":{"title":"SQLi","severity":"critical","locationPath":"src/api.ts:42"}}
data: {"type":"error","message":"Something went wrong"}
data: {"type":"done","scanId":"scan-uuid"}
```

---

## Findings

### `GET /api/findings/:id`

Get a single finding with all detail fields.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "finding-uuid",
    "scanId": "scan-uuid",
    "detector": "llm",
    "severity": "high",
    "confidence": 0.85,
    "exploitability": 0.7,
    "title": "SQL injection in user query",
    "description": "Direct string interpolation in SQL query allows injection",
    "locationPath": "src/api/users.ts",
    "locationLineStart": 42,
    "locationLineEnd": 45,
    "locationCommit": "abc123",
    "dataFlow": "User input → query string → SQL execution",
    "patchDiff": "--- a/src/api/users.ts\n+++ b/src/api/users.ts\n...",
    "patchExplanation": "Use parameterized queries",
    "validationModel": "cli:claude",
    "validationPasses": true,
    "validationRationale": "Confirmed — user input reaches raw SQL query",
    "fpFiltered": false,
    "tags": ["domain:auth"],
    "createdAt": "2026-05-03T12:05:00Z"
  }
}
```

### `PATCH /api/findings/:id`

Update a finding (mark as false positive, add tags).

**Request**:
```json
{
  "fpFiltered": true,
  "tags": ["false-positive", "reviewed"]
}
```

**Response** (200): Updated finding DTO.

### `DELETE /api/findings/:id`

Delete a finding.

**Response** (200): `{ "success": true, "data": null }`

---

## Reports

### `GET /api/reports/:scanId`

Export a scan report. Supports 4 formats.

**Query params**:
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `format` | string | No | `json` (default), `md`, `sarif`, `csv` |

**Response** (200): Report file content with appropriate `Content-Type` header.

---

## Config

### `GET /api/config`

Get the public configuration (API keys are masked).

**Response** (200):
```json
{
  "success": true,
  "data": {
    "models": {
      "llm-scan": "cli:claude:claude-sonnet-4-5",
      "validate": "api:openai:gpt-4o-mini"
    },
    "providers": {
      "anthropicKey": true,
      "openaiKey": true,
      "googleKey": false
    },
    "theme": "dark",
    "workerMemoryMb": 2048,
    "stage2Concurrency": 4
  }
}
```

### `PUT /api/config`

Update configuration. API keys are accepted but never returned in responses.

**Request**:
```json
{
  "models": {
    "llm-scan": "cli:claude:claude-sonnet-4-5"
  },
  "providers": {
    "anthropicKey": "sk-ant-..."
  },
  "theme": "dark"
}
```

**Response** (200): `{ "success": true, "data": null }`

---

## Providers

### `GET /api/providers`

List all available LLM providers with their status and models.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "cli": [
      {
        "id": "claude",
        "type": "cli",
        "name": "Claude Code",
        "bin": "claude",
        "available": true,
        "path": "/usr/local/bin/claude",
        "version": "2.0.0",
        "models": [
          { "id": "default", "label": "Default (CLI config)" },
          { "id": "claude-sonnet-4-5", "label": "Claude Sonnet 4.5" }
        ],
        "streamFormat": "claude-stream-json"
      }
    ],
    "api": [
      { "id": "anthropic", "type": "api", "label": "Anthropic API", "models": [...] }
    ]
  }
}
```

---

## Sources

### `POST /api/sources`

Validate a source before creating a scan. Checks accessibility (git credentials, local path existence).

**Request**:
```json
{
  "sourceType": "github",
  "sourceRef": "https://github.com/org/repo"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "sourceType": "github",
    "sourceRef": "https://github.com/org/repo",
    "noAccess": false
  }
}
```

---

## Prerequisites

### `GET /api/prereqs`

Check which system tools are available (classical scanners + git).

**Response** (200):
```json
{
  "success": true,
  "data": {
    "git": true,
    "gitleaks": true,
    "trufflehog": false,
    "semgrep": true,
    "osv-scanner": true
  }
}
```
