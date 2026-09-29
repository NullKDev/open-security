# ADR-0002: SQLite over PostgreSQL

**Status**: Accepted (2026-05-02)

## Context

open-security is a local-first tool. It needs a database for projects, scans, findings, commits, and configuration. We evaluated SQLite (via better-sqlite3 + Drizzle ORM) against PostgreSQL.

## Decision

**Use SQLite with better-sqlite3 and Drizzle ORM.**

## Consequences

### Positive
- **Zero setup**: No `brew install postgres`, no `pg_hba.conf`, no `CREATE DATABASE`. The database is a single file.
- **Local-first aligned**: Data lives in `.obt/db.sqlite` alongside scan artifacts. Users can copy/move/backup the entire workspace.
- **No daemon**: No background database process. SQLite runs in-process.
- **Fast enough**: For a single-user desktop tool scanning one repo at a time, SQLite's performance is more than adequate.
- **Drizzle type safety**: Full TypeScript types from the schema, no raw SQL in application code.

### Negative
- **No concurrency**: WAL mode helps, but concurrent writes from multiple scans would be problematic. Mitigated by running one scan at a time (in-process).
- **No network access**: Can't connect from another machine. Not a problem for local-first design.
- **Bun incompatibility**: `better-sqlite3` is a native C++ addon that doesn't work in Bun's runtime. DB tests must use `npx vitest` (Node.js).

## Alternatives considered

- **PostgreSQL**: Industry standard, but overkill for a single-user local tool. Adds setup burden that contradicts "local-first."
- **bun:sqlite**: Bun-native SQLite, but less mature ORM support and we need Drizzle for type-safe migrations.
- **JSON files**: Simple but no querying, no migrations, no type safety.
