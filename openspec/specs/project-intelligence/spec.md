# Project Intelligence Specification

## Purpose

Defines the behavior of Pass 0 — the LLM-driven ProjectMap generation step that precedes domain scans in `intermediate` and `paranoid` modes.

## Requirements

### Requirement: ProjectMap Generation

The system MUST invoke a dedicated LLM pass before any domain scan in `intermediate` or `paranoid` mode. The pass MUST receive the stage0 file tree and representative source samples as context. The LLM response MUST conform to the ProjectMap Zod schema before use.

ProjectMap fields: `stack` (string[]), `frameworks` (string[]), `entryPoints` (string[]), `attackSurface` (string[]), `domains` (string[], 3–4 for intermediate / 5–7 for paranoid), `relevantSkillIds` (string[]).

#### Scenario: Successful ProjectMap generation

- GIVEN a scan in `intermediate` or `paranoid` mode has completed stage0
- WHEN the system invokes the Pass 0 LLM prompt
- THEN the response is Zod-validated against the ProjectMap schema
- AND the validated ProjectMap is written to `<workspaceRoot>/projectMap.json`
- AND the JSON is serialized and stored in `scans.project_map`

#### Scenario: Malformed JSON from LLM

- GIVEN the Pass 0 LLM response is not valid JSON or fails Zod validation
- WHEN the system attempts to parse it
- THEN the system retries once with a stricter prompt
- AND if the second attempt also fails, the system falls back to a default ProjectMap derived from stage0 stack hints
- AND a warning event is emitted; the scan continues

### Requirement: ProjectMap Persistence

The system MUST persist the ProjectMap to both the workspace filesystem and the database. A scan MUST remain readable even if `project_map` is NULL (e.g., `quick` / `standard` scans).

#### Scenario: Persisted map is retrievable

- GIVEN a completed `intermediate` scan
- WHEN the scan record is fetched from the DB
- THEN `scans.project_map` contains valid JSON matching the ProjectMap schema

#### Scenario: Standard scan has no project map

- GIVEN a completed `standard` scan
- WHEN the scan record is fetched from the DB
- THEN `scans.project_map` is NULL and no error occurs
