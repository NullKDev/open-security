# LLM Providers

open-security supports **11 LLM providers** across two categories: CLI agents (spawned as child processes) and API SDKs (using the Vercel AI SDK).

## Provider types

### CLI agents

CLI tools run as child processes spawned by the pipeline. Seven agents are currently defined:

| Agent | ID | Binary | Transport | Tool use |
|-------|----|--------|-----------|---------|
| Claude Code | `claude` | `claude` | `sdk` | Yes |
| OpenCode | `opencode` | `opencode` | `acp` | Yes |
| Codex CLI | `codex` | `codex` | `acp` | Yes |
| Gemini CLI | `gemini` | `gemini` | `acp` | Yes |
| Cursor Agent | `cursor-agent` | `cursor-agent` | `acp` | Yes |
| Qwen Code | `qwen` | `qwen` | `acp` | No |
| GitHub Copilot | `copilot` | `npx` | `acp` | Yes |
| Auggie | `auggie` | `npx` | `acp` | Yes |
| Ollama | `ollama` | `ollama` | `http` | No |

### Transport kinds

Each CLI agent uses one of three transport kinds to communicate with the pipeline:

| Kind | Description | Agents |
|------|-------------|--------|
| `sdk` | Official SDK package (`@anthropic-ai/claude-agent-sdk`). Dynamic import with graceful fallback if not installed. | Claude Code |
| `http` | Streaming HTTP fetch to a local daemon. No binary on PATH required — daemon must be running. | Ollama |
| `acp` | JSON-RPC 2.0 over stdio. Sends an `initialize` handshake, then `run` requests. | OpenCode, Codex, Gemini, Cursor, Qwen, Copilot, Auggie |

### API SDKs

API-based providers use the Vercel AI SDK (`ai` package) for streaming:

| Provider | ID | Package | Models |
|----------|----|---------|--------|
| Anthropic | `anthropic` | `@ai-sdk/anthropic` | Claude Opus 4.5, Sonnet 4.5/4.6, Haiku 4.5 |
| OpenAI | `openai` | `@ai-sdk/openai` | GPT-4o, GPT-4o Mini, O3, O4 Mini |
| Google AI | `google` | `@ai-sdk/google` | Gemini 2.5 Pro, Gemini 2.0 Flash |
| Ollama (API) | `ollama` | `ollama-ai-provider` | Llama 3, Code Llama, DeepSeek Coder |

## Configuration

Models are configured in **Settings** (`/config`) in the UI, or directly in `.obt/config.json`:

```json
{
  "models": {
    "llm-scan": "cli:claude:claude-sonnet-4-5",
    "validate":  "api:anthropic:claude-haiku-4-5",
    "filter":    "api:openai:gpt-4o-mini",
    "patch":     "cli:claude:claude-sonnet-4-5"
  },
  "providers": {
    "anthropicKey": "sk-ant-...",
    "openaiKey":    "sk-...",
    "googleKey":    "...",
    "ollamaKey":    ""
  }
}
```

### Model string format

```
cli:<agentId>                  Agent default model (no --model flag passed)
cli:<agentId>:<modelId>        Specific model: "cli:claude:claude-sonnet-4-5"
api:<providerId>:<modelId>     API SDK:         "api:anthropic:claude-sonnet-4-5"
```

### Per-stage routing

Each pipeline stage can use a different provider. This lets you run a high-capability model for the main scan and a cheaper model for validation:

| Stage | Config key | Default recommendation |
|-------|-----------|----------------------|
| `llm-scan` | `models['llm-scan']` | High-capability: Claude Sonnet, GPT-4o, Gemini 2.5 Pro |
| `validate` | `models['validate']` | Fast/cheap: Claude Haiku, GPT-4o Mini |
| `filter` | `models['filter']` | Fast/cheap (or omit — uses llm-scan provider) |
| `patch` | `models['patch']` | High-capability (same as llm-scan, or a reasoning model) |

If a stage has no model configured, the pipeline falls back to the `llm-scan` provider.

### Project-level model snapshot

When a scan starts, `persistModelsUsed()` records the resolved providers for each stage in `scans.models_used`. This provides an audit trail of which models analyzed which findings.

## Provider detection

The `/api/providers` endpoint probes all CLI agents and returns their status:

1. Scans PATH directories for the agent binary
2. Runs the `probeArgs` command (usually `--version`) to confirm availability
3. For agents with `listModels` defined, runs the model discovery command
4. Returns: `{ id, available, version?, models[] }` for each agent

API providers are always listed (no local binary required — they're SaaS).

## Provider selection flow

```
createProviderForStage(stage)
  │
  ├─ readConfig() → config.models[stage]
  ├─ resolveModelString(raw)
  │     "cli:claude:claude-sonnet-4-5" → { kind: 'cli', agentId: 'claude', modelId: '...' }
  │     "api:anthropic:claude-haiku-4-5" → { kind: 'api', providerId: 'anthropic', modelId: '...' }
  │
  ├─ kind: 'cli'
  │     getAgentDef(agentId) → AgentDef
  │     findOnPath(def.bin)  → checks binary availability
  │     makeCliClient(def, modelId)
  │           ├─ transport: 'sdk'  → claudeSdkScan()   (@anthropic-ai/claude-agent-sdk)
  │           ├─ transport: 'http' → ollamaHttpScan()  (fetch to localhost:11434)
  │           └─ transport: 'acp'  → acpScan()          (JSON-RPC 2.0 over stdio)
  │
  └─ kind: 'api'
        createApiModel(providerId, modelId)
        wrapStreamText(streamText({ model, prompt }))
```

## Adding a new CLI agent

1. Add an entry to `AGENT_DEFS` in `lib/providers/cli/agents.ts`:

```typescript
// ACP agent (JSON-RPC 2.0 over stdio)
{
  id: 'my-agent',
  name: 'My Agent',
  bin: 'my-agent',
  probeArgs: ['--version'],
  streamFormat: 'json-event-stream',
  transport: 'acp',
  acpArgs: ['--acp'],              // Args to start the agent in JSON-RPC mode
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'my-model', label: 'My Model' },
  ],
  buildArgs: () => {
    // ACP transport never calls buildArgs — throw to catch misuse
    throw new Error('ACP transport should not call buildArgs')
  },
}
```

2. For `acp` transport: `acpScan()` handles the JSON-RPC 2.0 handshake automatically. Confirm the agent starts correctly with `my-agent --acp` and responds to `initialize` + `run` requests.

3. For a new transport kind: implement a module in `lib/providers/transport/` and add a case in `makeCliClient()` in `lib/providers/stage-routing.ts`.

4. Add `fallbackModels` so the UI can display model options even when the agent is unavailable. If the agent supports runtime model discovery, add a `listModels` object with `args`, `timeoutMs`, and a `parse` function.

> Never use plain text output. All transports must produce structured JSON. The plain-text `StreamFormat` has been removed from the codebase.

## Adding a new API provider

1. Add to `API_PROVIDERS` in `app/api/providers/route.ts`
2. Add a case in `lib/providers/api/factory.ts` if it needs special SDK initialization (most providers work with a direct `createApiModel` call)
3. Add the API key field to `ObtConfig.providers` in `lib/config/schema.ts`
4. Ensure the Zod schema validates and the Settings UI exposes the new key field

## External agent config

To use an agent definition from an external JSON file (for private or experimental agents), set:

```bash
export ACP_AGENTS_CONFIG=/path/to/agents.json
```

The file should be a JSON array of `AgentDef` objects. Entries with the same `id` as a built-in agent override it; new `id` values are appended. On any load error, the built-in agents are used unchanged.

## Security notes

- CLI agents have filesystem access within the scan workspace directory — they run with `--dangerously-skip-permissions`
- API keys are stored in `.obt/config.json` (gitignored). File permissions are the user's responsibility.
- No keys are transmitted except to their respective API endpoints
- CLI spawn uses array args (never shell string construction) — prevents argument injection
- Binary availability is checked via `findOnPath()` before creating a CLI provider — prevents ENOENT at scan time
