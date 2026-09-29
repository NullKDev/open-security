# Contributing to open-security

Thanks for your interest in contributing! This guide covers everything from local setup to submitting a pull request.

## Development Setup

**Prerequisites**: [bun](https://bun.sh) (package manager + runtime), git, Node.js 20+

```bash
git clone https://github.com/NullKDev/open-security.git
cd open-security
bun install
bun run dev        # UI at http://localhost:3000
bun run test       # 500+ tests, vitest
```

### Project stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict mode) |
| UI | React 19 + Tailwind CSS v4 |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Testing | Vitest 4 + @testing-library/react |
| Linting | ESLint (eslint-config-next) |
| Formatting | Prettier 3 |

### Workspace layout

Everything lives under `.obt/` in the project root. Run `bun run dev` once and it creates the workspace automatically.

```
.obt/
  db.sqlite         SQLite database
  config.json       API keys, model selection
  projects/         Per-project scan data
  reports/          Exported reports
```

## Architecture

open-security is a **single Next.js process**. No separate backend, no daemon, no microservices. Scans run in-process with SSE streaming.

### Pipeline (5 stages)

```
Stage 0 (Prep) → Stage 1 (Classical) → Stage 2 (LLM) → Stage 3 (Validate) → Stage 4 (Filter) → Stage 5 (Patch)
```

See [openspec/specs/](openspec/specs/) for detailed specifications.

### Key directories

```
app/              Next.js App Router pages
components/       React components (ui/, project/, source/, theme/)
lib/              Core modules
  pipeline/       Scan pipeline stages + strategies
  providers/      LLM providers (CLI spawn + API SDKs)
  scanners/       Classical scanner wrappers
  detectors/      LLM vulnerability detectors
  repos/          Database repositories (Drizzle)
  config/         Configuration store + schema
bin/              CLI entry point (obt)
detectors/        12 SKILL.md detector bundles
policies/         3 YAML policy files
openspec/         Spec-driven development specs
```

## SDD Workflow

All changes follow **Spec-Driven Development (SDD)**. No exceptions.

```
explore → propose → spec → design → tasks → apply → verify → archive
```

- **Orchestrator** (`sdd-orchestrator`) coordinates phases
- **Sub-agents** execute individual phases
- **Artifacts** are stored in engram (persistent memory) and `openspec/` (filesystem)
- Use `/sdd-new <change>` or `/sdd-ff <change>` to start

## Code Patterns

- **Zod validation** at all API boundaries — schemas in `lib/api/schemas/`
- **JSDoc** on all exported functions — describe WHAT, not HOW
- **No raw `@/` imports** for new modules — use explicit relative paths within `lib/`
- **No `any` types** — TypeScript strict mode is enforced
- **Provider interface**: All LLM clients implement `ProviderClient` from `lib/providers/index.ts`
- **Detectors**: YAML frontmatter with `id`, `severity`, `description` + Markdown prompt body

## Testing

```bash
bun run test              # Run all tests (vitest)
bun run test:watch        # Watch mode for TDD
bun run test:coverage     # Coverage report (target: 85%+)
```

### Test layers

| Layer | Tool | Example |
|-------|------|---------|
| Unit | vitest | `tests/unit/pipeline/stage4-filter.test.ts` |
| Integration | vitest + jsdom | `tests/integration/pipeline/runner.test.ts` |
| Component | @testing-library/react | `components/ui/__tests__/ScanModePicker.test.tsx` |

### DB-dependent tests

Tests that use `better-sqlite3` require **Node.js** (not Bun's native runtime):

```bash
npx vitest run tests/unit/repos/
```

## Pull Request Process

1. **SDD phase**: All substantial changes MUST go through SDD (explore → propose → ... → verify)
2. **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
3. **No AI attribution**: Never add `Co-Authored-By` or AI credits to commits
4. **Describe WHY**: Commit messages explain motivation, not just what changed
5. **Tests required**: Every new feature or fix needs tests (TDD: RED → GREEN → REFACTOR)
6. **Type check**: `npx tsc --noEmit` must pass
7. **DESIGN.md**: Update if UI changes

## Questions?

Open an issue or start with `/sdd-explore` in the SDD orchestrator.
