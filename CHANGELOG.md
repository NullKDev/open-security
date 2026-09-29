# Changelog

All notable changes to open-security are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [Unreleased]

### Added
- **Stable provider transports**: CLI providers now use four typed transport surfaces instead of brittle stream-format parsers
  - `sdk` — Claude via `@anthropic-ai/claude-agent-sdk@0.2.8` (dynamic import, graceful fallback)
  - `http` — Ollama via direct `fetch` to `localhost:11434/api/chat` (probe + streaming)
  - `acp` — Gemini + Codex via JSON-RPC 2.0 over stdio (`initialize` handshake + `run` requests)
  - `spawn-json` — OpenCode, Cursor Agent, Qwen via `--output-format json` flag
- `TransportKind = 'sdk' | 'http' | 'acp' | 'spawn-json'` exported from `lib/providers/cli/agents.ts`
- `pipeStdin` option on `spawnProvider()` for transports that need writable stdin (ACP)

### Removed
- `lib/providers/cli/parsers/plain.ts` — plain-text regex parser (Level 5) removed; all agents must declare a structured transport
- `lib/providers/cli/parsers/claude-stream-json.ts` — replaced by SDK transport
- `handleGemini()` and `handleCodex()` from `native-to-findings.ts` — replaced by ACP transport


- **4 scan modes**: `quick`, `standard`, `intermediate`, `paranoid` — replacing legacy `deep` mode
- **Orchestrated scanning**: Pass 0 generates a ProjectMap via LLM, then per-domain security scans with skill rule injection
- **FP filter fix**: False-positive filter correctly reads `match_path` globs from `fp-filter.yaml` (was silently dropping all findings due to schema mismatch)
- **Model config per project**: Models are now snapshotted per project at creation time, shown in scan UI as an informative card
- **`models_used` populated**: Pipeline now records which models were resolved for each stage in `scans.models_used`
- **Spawn error handling**: `spawnProvider` no longer produces unhandled rejections when CLI binaries are unavailable

### Changed
- **Removed model selector** from scan creation sidebar wizard — model config lives in Settings only
- **`stage2-llm` signature**: `promptOverride` → required `prompt` field, adds domain/detectorPrefix/tags support
- **`buildScanPrompt`**: Now public export with extended options for skill injection and domain scoping

### Fixed
- FP filter schema mismatch: `stage4-filter.ts` now uses Zod-validated policy loader with glob→regex conversion
- `spawn opencode ENOENT` unhandledRejection: error caught internally, streams destroyed cleanly

## [0.1.0] - 2026-05-02

### Added
- **Initial release** — Blue Team security workbench
- **4 source ingestion types**: GitHub, GitLab, local folder, ZIP upload (200 MB limit)
- **4 classical scanners**: gitleaks, trufflehog, semgrep, osv-scanner
- **12 LLM vulnerability detectors**: SQLi, XSS, SSRF, path traversal, command injection, insecure deserialization, auth bypass, crypto misuse, dependency context, + 3 git forensics detectors
- **3 git history forensics**: secrets in history, suspicious commits, author anomalies
- **4 report formats**: JSON, Markdown (interlinked findings), SARIF 2.1.0, CSV
- **11 LLM providers**: Claude Code, OpenCode, Codex, Gemini CLI, Cursor, Qwen Code, Ollama CLI + Anthropic/OpenAI/Google/Ollama API SDKs
- **CLI tool** (`obt`): scan, history, report, agents commands
- **SSE streaming**: Real-time scan progress via Server-Sent Events with ScanBus pub/sub
- **5-stage pipeline**: Prep → Classical → LLM Scan → Validate → Filter → Patch synthesis
- **Spec-Driven Development**: Full SDD workflow with hybrid artifact store (engram + openspec)
- **3 policies**: severity thresholds, confidence thresholds, FP filter rules
- **UI**: Premium dark theme, Apple-inspired design, sidebar workflow, scan progress viewer with thinking visualization
