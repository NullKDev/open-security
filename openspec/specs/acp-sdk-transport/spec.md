# ACP SDK Transport Specification

## Purpose

Defines the ACP client lifecycle, session management, login-shell spawn, and traffic logging requirements for the `@agentclientprotocol/sdk@0.21.0`-based transport layer that replaces the hand-rolled JSON-RPC implementation in `lib/providers/transport/acp.ts`.

## Requirements

### Requirement: SDK Dependency Pinned

The project MUST declare `@agentclientprotocol/sdk` at exactly version `0.21.0` in `package.json` and the lockfile MUST reflect this exact version with no floating ranges.

#### Scenario: Correct version in manifest

- GIVEN `package.json` is read
- WHEN the `dependencies` field is inspected
- THEN `@agentclientprotocol/sdk` MUST appear with the exact specifier `0.21.0`

---

### Requirement: Login-Shell Spawn

When spawning an ACP agent process, the transport MUST launch the binary through a login shell (`$SHELL -l -c <cmd>`) so that user PATH entries (e.g., nvm, homebrew) are resolved on macOS.

#### Scenario: Login shell used on spawn

- GIVEN `$SHELL` is `/bin/zsh`
- WHEN `spawnLoginShell("gemini", ["--acp"])` is called
- THEN the child process MUST be started as `["/bin/zsh", "-l", "-c", "gemini --acp"]`

#### Scenario: Fallback when $SHELL is unset

- GIVEN `process.env.SHELL` is `undefined`
- WHEN `spawnLoginShell(bin, args)` is called
- THEN the transport MUST fall back to `/bin/sh -l -c <cmd>` and NOT throw

---

### Requirement: ClientSideConnection Lifecycle

The transport MUST establish an ACP session using `ClientSideConnection` from `@agentclientprotocol/sdk`. The lifecycle MUST follow: spawn → connect → `session/new` → `session/prompt` → stream updates → `session/cancel` or natural completion.

#### Scenario: Successful session lifecycle

- GIVEN an ACP-capable agent binary is on PATH
- WHEN `acpScan(def, prompt, opts)` is called
- THEN a `ClientSideConnection` MUST be instantiated with the spawned process
- AND `session/new` MUST be sent before `session/prompt`
- AND `sessionUpdate` notifications MUST be consumed from the connection stream
- AND on the final `sessionUpdate` with `status: "completed"`, a `done` event MUST be yielded

#### Scenario: Connection error before session/new

- GIVEN the agent binary exits immediately with a non-zero code
- WHEN the transport attempts to connect
- THEN an `error` ProviderEvent MUST be yielded with the process stderr in the message
- AND no further events MUST be yielded after the error

#### Scenario: Cancellation via AbortSignal

- GIVEN an active ACP session is in progress
- WHEN `opts.signal.abort()` fires
- THEN `connection.cancel()` MUST be called
- AND the spawned process MUST receive SIGTERM followed by SIGKILL after 5 seconds if still alive
- AND all pending permission promises MUST be rejected with an `AbortError`

---

### Requirement: Traffic Logging

The transport MUST log all ndjson lines sent to and received from the agent process at `debug` level. Log entries MUST include direction (`→` send, `←` recv), the raw line content, and a timestamp. Logging MUST NOT block the stream and MUST NOT cause stdout data loss.

#### Scenario: Inbound line logged

- GIVEN a `session/update` ndjson line arrives on stdout
- WHEN the transport processes the line
- THEN a debug-level log entry MUST be emitted with direction `←` and the raw line

#### Scenario: Outbound message logged

- GIVEN `session/prompt` is about to be sent
- WHEN the message is serialized and written to stdin
- THEN a debug-level log entry MUST be emitted with direction `→` and the serialized content

---

### Requirement: Process Leak Prevention

The transport MUST guarantee the spawned process is terminated when the scan generator is garbage-collected or the scan errors out. No zombie processes MUST remain after scan completion or cancellation.

#### Scenario: Process terminated on natural completion

- GIVEN a scan completes with `status: "completed"`
- WHEN the async generator function returns
- THEN the spawned process MUST be `.kill()`ed if it has not already exited

#### Scenario: Process terminated on generator throw

- GIVEN an unhandled error is thrown inside the generator
- WHEN the `finally` block runs
- THEN `SIGTERM` MUST be sent to the spawned process within 500ms

---

### Requirement: Zero Regex Parsing

The rewritten `acp.ts` MUST NOT contain any regular expression literal or `RegExp` constructor used to parse ACP protocol output. All protocol parsing MUST be delegated to the SDK.

#### Scenario: No regex in transport file

- GIVEN the final implementation of `lib/providers/transport/acp.ts`
- WHEN the file is statically analyzed
- THEN no `/regex/` literals or `new RegExp(...)` calls MUST be present for parsing ACP ndjson
