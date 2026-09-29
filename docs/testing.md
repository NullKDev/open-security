# Testing Guide

open-security uses **Vitest 4** with **jsdom** for component tests and **better-sqlite3** for database tests. 500+ tests, 85%+ coverage target.

## Quick reference

```bash
bun run test              # All tests (vitest run)
bun run test:watch        # Watch mode for TDD
bun run test:coverage     # Coverage report
npx tsc --noEmit          # Type check (no tests, just compilation)
```

## Test layers

| Layer | Tool | Directory | Example |
|-------|------|-----------|---------|
| **Unit** | vitest | `tests/unit/` | `tests/unit/pipeline/stage4-filter.test.ts` |
| **Integration** | vitest + jsdom | `tests/integration/` | `tests/integration/pipeline/runner.test.ts` |
| **Component** | @testing-library/react | `components/*/__tests__/` | `components/ui/__tests__/ScanModePicker.test.tsx` |
| **DB** | vitest + better-sqlite3 | `tests/unit/repos/`, `tests/unit/db/` | `tests/unit/repos/scans.test.ts` |
| **Security** | vitest | `tests/security/` | `tests/security/spawn-injection.test.ts` |

## Running different test types

### Unit tests (no DB, no browser)

```bash
bun test tests/unit/pipeline/ tests/unit/skills/ tests/unit/providers/
```

These run fast. Use them during TDD.

### DB-dependent tests

`better-sqlite3` is a native C++ addon — **not supported in Bun's runtime**. Must use Node.js:

```bash
# BAD — will fail with "better-sqlite3 not supported"
bun test tests/unit/repos/

# GOOD — uses Node.js via npx
npx vitest run tests/unit/repos/
```

### Component tests (@testing-library/react)

These require a DOM environment. Vitest config provides `jsdom`:

```bash
bun test components/ --environment jsdom
```

Some component tests may fail in Bun due to `document is not defined` — they work with `npx vitest` instead.

### Full suite

```bash
# Vitest with all layers (some DB tests may fail in Bun)
bun run test

# Or use Node.js for full compatibility
npx vitest run
```

## TDD Workflow (RED → GREEN → REFACTOR)

open-security enforces **Strict TDD** when testing capabilities are detected. Every task with `TEST:` in its spec requires this cycle:

### 1. RED — Write a failing test FIRST

```typescript
// tests/unit/pipeline/stage4-filter.test.ts
it('drops finding matching a match_path glob rule', async () => {
  const rules = [rule('**/*.test.*')]
  const result = await runStage4Filter({
    scanId: 'test',
    validated: [{ finding: stagingFinding({ locationPath: 'src/button.test.tsx' }), passes: true, rationale: '', model: '' }],
    onEvent: () => {},
    _rules: rules,
  })
  expect(result.filtered).toHaveLength(0) // dropped
})
```

**Verify it fails** (`bun test -- -t "drops finding"`). If it passes before implementation, the test is wrong.

### 2. GREEN — Write minimal code to pass

```typescript
// lib/pipeline/stage4-filter.ts
export function globToRegex(glob: string): RegExp {
  // Minimal implementation that handles '**/*.test.*'
  return new RegExp('^.*\\/[^/]*\\.test\\.[^/]*$')
}
```

Run the test again. It should pass now.

### 3. REFACTOR — Clean up without changing behavior

```typescript
// Generalize to handle all glob patterns, not just test files
export function globToRegex(glob: string): RegExp {
  let src = '^'
  // ... full implementation
  return new RegExp(src + '$')
}
```

### 4. TRIANGULATE — Add more cases

Write additional tests for edge cases before considering the task complete.

## Mocking without `vi.mocked`

Vitest 4.1.5 (Bun runtime) **does not support `vi.mocked` or `vi.hoisted`**. Use these patterns instead:

### Pattern 1: Dependency injection (preferred)

```typescript
// In production code — accept an optional override
export async function runStage4Filter(opts: Stage4Opts): Promise<Stage4Result> {
  const rules = opts._rules ?? (await loadParsedRules())
  // ...
}

// In test — inject rules directly, no mocking needed
const result = await runStage4Filter({
  _rules: [rule('**/*.test.*')],
  // ...
})
```

### Pattern 2: Module-level mock variable

```typescript
// Create mock at module scope BEFORE vi.mock
const mockFn = vi.fn()

// vi.mock hoists but references the outer variable
vi.mock('@/lib/some-module', () => ({
  someFunction: mockFn,
}))

// Use mockFn directly in tests
mockFn.mockResolvedValue({ data: 'test' })
```

### Pattern 3: Manual stub objects

```typescript
const stubProvider = {
  id: 'stub:test',
  capability: { stream: true, tools: false, jsonMode: false },
  async *scan(_opts: ScanOpts) {
    yield { type: 'thinking', text: 'analysis...' }
    yield { type: 'done' }
  },
}
```

## Test file conventions

```
tests/
  unit/
    pipeline/stage4-filter.test.ts    ← mirrors lib/pipeline/stage4-filter.ts
    providers/resolve.test.ts         ← mirrors lib/providers/cli/resolve.ts
    repos/scans.test.ts
  integration/
    pipeline/runner.test.ts
  security/
    spawn-injection.test.ts
  api/
    findings.test.ts

components/
  ui/__tests__/ScanModePicker.test.tsx   ← co-located with component
  project/__tests__/ScanConfig.test.tsx
```

**Rule**: Test files mirror the source structure. Unit tests in `tests/unit/<module>/`, component tests co-located.

## Coverage

```bash
bun run test:coverage
```

Target: **85%+** across all modules. Coverage provider: `v8` (not `istanbul`).

Coverage thresholds are configured in `vitest.config.ts`.

## Debugging tests

```bash
# Run a single test file
bun test tests/unit/pipeline/stage4-filter.test.ts

# Run a single test by name pattern
bun test -- -t "globToRegex"

# Run with verbose output
bun test --reporter verbose  # Not supported — use default dots reporter
```

## Writing good tests

1. **One behavior per test** — `it('drops finding matching glob', ...)`, not `it('tests filter', ...)`
2. **Assert real behavior** — `expect(result.filtered).toHaveLength(0)`, not `expect(mockFn).toHaveBeenCalled()`
3. **Triangulate** — at least 3 cases per behavior (happy path, edge case, error case)
4. **No DB in unit tests** — use in-memory stubs. DB tests go in `tests/unit/repos/` or `tests/unit/db/`
5. **Clean up** — if your test creates files, use `fs.mkdtempSync()` and clean up in `afterEach`
