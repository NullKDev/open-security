# ADR-0001: Next.js 16 Single-Process Architecture

**Status**: Accepted (2026-05-02)

## Context

open-security needed a web UI and an API to trigger security scans. The traditional approach would be a React SPA + separate Express backend. We had to choose between that split architecture and a unified Next.js approach.

## Decision

**Use Next.js 16 App Router as a single process** — serving both the UI and API routes, and running the scan pipeline in-process.

## Consequences

### Positive
- **Zero infrastructure**: No process manager, no reverse proxy config for two services, no CORS
- **SSE streaming native**: Next.js streaming response works perfectly for scan progress events
- **Type sharing**: Backend and frontend share types without a monorepo or package boundary
- **Single deploy**: One `next start` command runs everything

### Negative
- **No worker isolation**: Fork-based orchestrator is needed for Next.js dev mode where `worker.js` is unavailable
- **Scan blocks the event loop**: Long-running classical scanners block the Next.js server. Mitigated by spawning child processes for classical scanners.
- **No hot reload during scans**: Next.js dev server restarts kill running scans

## Alternatives considered

- **Express + React (Vite)**: More control over server lifecycle, but adds deployment complexity, CORS, and type duplication
- **Next.js Pages Router**: Would have worked, but App Router has better streaming (SSE) and RSC patterns
- **Tauri / Electron**: Desktop-first, but users wanted a web interface accessible from any device on the network
