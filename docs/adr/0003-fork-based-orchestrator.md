# ADR-0003: Fork-Based Orchestrator for Classical Scanners

**Status**: Accepted (2026-05-02)

## Context

Classical scanners (gitleaks, trufflehog, semgrep, osv-scanner) are external CLI tools that need to run on the source tree. We needed a way to invoke them and capture their output.

## Decision

**Spawn classical scanners as child processes** using `child_process.spawn()` with array-form arguments. Run them in parallel, collect JSON output, normalize to a common finding format.

## Consequences

### Positive
- **Process isolation**: Scanner crashes don't take down the Next.js server
- **Parallel execution**: All 4 scanners run simultaneously, reducing wall-clock time
- **No wrapper needed**: Scanners are invoked as-is, no SDK or API wrapper required
- **Security boundary**: Scanners run with the user's permissions, not escalated

### Negative
- **Process overhead**: Each scanner is a separate process with cold-start cost
- **Output parsing**: Each scanner has a different JSON output format — normalization layer required
- **Error handling**: Scanner failures need graceful degradation (skip missing scanners, continue with others)
- **Platform dependency**: Scanners must be installed on the user's machine (`brew install gitleaks` etc.)

## Alternatives considered

- **Worker threads**: Lighter weight than child processes, but Go/Rust scanners can't run in JavaScript threads
- **Docker containers**: More isolation, but adds Docker dependency — contradicts local-first simplicity
- **WebAssembly**: Would eliminate platform dependency, but complex build pipeline and WASM support varies by scanner
