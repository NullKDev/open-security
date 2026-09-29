# Agent Configurations Specification

## Purpose

Defines the corrected `AgentDef` entries for `gemini`, `opencode`, `qwen`, and `codex` in `lib/providers/cli/agents.ts`. All four agents MUST be routed through the ACP transport with correct `acpArgs`.

## Requirements

### Requirement: Gemini Uses --acp Flag

The `gemini` agent definition MUST set `transport: 'acp'` and `acpArgs: ['--acp']`. The current value `acpArgs: ['acp']` (subcommand form) MUST NOT appear in the final definition.

#### Scenario: Correct acpArgs for gemini

- GIVEN `AGENT_DEFS` is loaded
- WHEN the entry with `id: 'gemini'` is found
- THEN `def.transport` MUST equal `'acp'`
- AND `def.acpArgs` MUST equal `['--acp']`

#### Scenario: Gemini spawns with flag, not subcommand

- GIVEN the gemini AcpScanClient is invoked
- WHEN the process is spawned
- THEN the argv MUST be `['gemini', '--acp']` (flag form), NOT `['gemini', 'acp']`

---

### Requirement: Opencode Uses ACP Transport

The `opencode` agent definition MUST set `transport: 'acp'` and `acpArgs: ['--acp']`. The existing `transport: 'spawn-json'` value and associated `buildArgs` that produce `run --format json` MUST be replaced.

#### Scenario: Opencode routes through ACP

- GIVEN `AGENT_DEFS` is loaded
- WHEN the entry with `id: 'opencode'` is inspected
- THEN `def.transport` MUST equal `'acp'`
- AND `def.acpArgs` MUST equal `['--acp']`

#### Scenario: Opencode buildArgs not called during ACP scan

- GIVEN `transport: 'acp'` is active
- WHEN `acpScan` is invoked for opencode
- THEN `def.buildArgs` MUST NOT be called as part of the scan invocation

---

### Requirement: Qwen Uses ACP Transport

The `qwen` agent definition MUST set `transport: 'acp'` and `acpArgs: ['--acp']`. The current `transport: 'spawn-json'` and `buildArgs: ['-p', prompt, '--output-format', 'json']` form MUST be superseded.

#### Scenario: Qwen agent def corrected

- GIVEN `AGENT_DEFS` is loaded
- WHEN the entry with `id: 'qwen'` is inspected
- THEN `def.transport` MUST equal `'acp'`
- AND `def.acpArgs` MUST NOT be `undefined`

---

### Requirement: Codex ACP Wrapper

The `codex` agent MUST be invoked via `npx @zed-industries/codex-acp@latest` as the primary ACP invocation method. The implementation MUST detect whether native `codex --acp` is available and fall back to the npx wrapper when the flag is absent.

#### Scenario: codex-acp wrapper used when native flag absent

- GIVEN `codex --acp --version` exits non-zero or outputs an error
- WHEN the transport resolves the spawn command
- THEN the process MUST be spawned as `npx @zed-industries/codex-acp@latest`

#### Scenario: Native flag preferred when available

- GIVEN `codex --acp --version` exits with code 0
- WHEN the transport resolves the spawn command
- THEN the process MUST be spawned as `codex --acp` (no npx overhead)

#### Scenario: Codex acpArgs reflects wrapper

- GIVEN native ACP flag is unavailable
- WHEN `AGENT_DEFS` is consumed by the ACP transport
- THEN `def.bin` or `def.acpArgs` MUST encode the `npx @zed-industries/codex-acp@latest` invocation

---

### Requirement: Agent buildArgs Unused for ACP Agents

For any `AgentDef` with `transport: 'acp'`, the `buildArgs` function MUST NOT be invoked by the ACP transport. `buildArgs` is reserved exclusively for `spawn-json` transport agents.

#### Scenario: ACP scan ignores buildArgs

- GIVEN an `AgentDef` with `transport: 'acp'`
- WHEN `acpScan(def, prompt, opts)` is called
- THEN `def.buildArgs` MUST NOT be called at any point during the scan
