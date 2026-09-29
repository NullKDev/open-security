# Skill Injection Specification

## Purpose

Defines how compact rules from `.atl/skill-registry.md` are resolved and injected into LLM prompts.

## Requirements

### Requirement: Rule Resolution

The system MUST read `.atl/skill-registry.md` from the project root. It MUST expose `resolveRulesForStack(stack: string[]): string` and `resolveRulesForDomain(domain: string, stack: string[]): string` returning compact rule blocks. If the registry is absent or unparseable, both functions MUST return an empty string and emit a warning event; the scan MUST continue.

#### Scenario: Rules resolved for known stack

- GIVEN a detected stack containing "next.js" and "typescript"
- WHEN `resolveRulesForStack` is called
- THEN the returned string contains at least one compact rule block whose trigger matches the stack
- AND the string is under 4 KB to stay within prompt budget

#### Scenario: Registry file is missing

- GIVEN `.atl/skill-registry.md` does not exist at the project root
- WHEN any resolve function is called
- THEN the function returns an empty string
- AND a warning event is emitted
- AND the scan continues without injected rules

#### Scenario: No matching skill for domain

- GIVEN a domain "iot-firmware" with no corresponding skill in the registry
- WHEN `resolveRulesForDomain` is called
- THEN the function returns an empty string without error

### Requirement: Prompt Injection

The system MUST include resolved skill rules in every LLM prompt where rules are non-empty. Rules MUST appear in a clearly delimited section (e.g., `## Security Skills`) so they do not interfere with other prompt sections.

#### Scenario: Rules injected into standard mode prompt

- GIVEN a `standard` scan with a detected stack "react" + "prisma"
- WHEN `buildScanPrompt` constructs the LLM prompt
- THEN the prompt contains a `## Security Skills` section with resolved rules for that stack
