# Skill Registry — open-security

Generated: 2026-05-02
Project: open-security
Stack: Next.js 16 + React 19 + TypeScript + Tailwind v4

---

## Compact Rules

### security-review
**Triggers**: authentication, user input, secrets, API endpoints, payment features
**Source**: ~/.claude/skills/security-review/SKILL.md
Use for: any code touching auth, credentials, file I/O, or external APIs.

### security-scan
**Triggers**: Claude Code config audit, .claude/ directory, hooks, MCP servers
**Source**: ~/.claude/skills/security-scan/SKILL.md

### blueprint
**Triggers**: multi-session plan, roadmap, complex multi-PR task
**Source**: ~/.claude/skills/blueprint/SKILL.md
Use for: turning a one-line objective into step-by-step construction plan.

### api-design
**Triggers**: REST API, routes, endpoints, pagination, error responses
**Source**: ~/.claude/skills/api-design/SKILL.md

### backend-patterns
**Triggers**: Node.js, Express, Next.js API routes, server-side architecture
**Source**: ~/.claude/skills/backend-patterns/SKILL.md

### sdd-explore
**Triggers**: SDD orchestrator launches explore phase
**Source**: ~/.claude/skills/sdd-explore/SKILL.md

### sdd-propose
**Triggers**: SDD orchestrator launches propose phase
**Source**: ~/.claude/skills/sdd-propose/SKILL.md

### sdd-spec
**Triggers**: SDD orchestrator launches spec phase
**Source**: ~/.claude/skills/sdd-spec/SKILL.md

### sdd-design
**Triggers**: SDD orchestrator launches design phase
**Source**: ~/.claude/skills/sdd-design/SKILL.md

### sdd-tasks
**Triggers**: SDD orchestrator launches tasks phase
**Source**: ~/.claude/skills/sdd-tasks/SKILL.md

### sdd-apply
**Triggers**: SDD orchestrator launches apply phase
**Source**: ~/.claude/skills/sdd-apply/SKILL.md

### sdd-verify
**Triggers**: SDD orchestrator launches verify phase
**Source**: ~/.claude/skills/sdd-verify/SKILL.md

### sdd-archive
**Triggers**: SDD orchestrator launches archive phase
**Source**: ~/.claude/skills/sdd-archive/SKILL.md

---

## Project Conventions

- **AGENTS.md** / **CLAUDE.md**: Next.js 16 breaking changes — read node_modules/next/dist/docs/ before coding
- No test runner installed — add vitest when testing is needed
- ESLint (eslint-config-next) is the active linter
- TypeScript strict mode enabled

---

## User Skills Trigger Table

| Context | Skill |
|---------|-------|
| Auth / secrets / user input / API | security-review |
| .claude/ config audit | security-scan |
| Multi-session plan / roadmap | blueprint |
| REST endpoints / pagination / errors | api-design |
| Node / Express / Next.js API routes | backend-patterns |
| SDD explore phase | sdd-explore |
| SDD propose phase | sdd-propose |
| SDD spec phase | sdd-spec |
| SDD design phase | sdd-design |
| SDD tasks phase | sdd-tasks |
| SDD apply phase | sdd-apply |
| SDD verify phase | sdd-verify |
| SDD archive phase | sdd-archive |
