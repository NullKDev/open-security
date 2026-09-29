---
id: js-child-process
title: Node.js Child Process Injection
stages: [llm-scan, validate]
severity: critical
description: Detects command injection in Node.js child process APIs — exec/execSync with user input, spawn/fork with shell:true, and vm module sandbox escape patterns.
classical_prepass: semgrep
classical_hint: p/javascript
---

# Node.js Child Process Injection

## Detection Prompt

```
Analyze Node.js code for child process injection. Look for:

1. exec/execSync with User Input:
   - exec(userInput), execSync(userInput) — always uses shell by default
   - exec(`command ${userInput}`) with template literals
   - execFile with shell: true and user-controlled arguments
   - spawn with shell: true

2. Unsafe Argument Passing:
   - String concatenation building command strings
   - User input reaching spawn() without array-form arguments
   - fork(argv) with user-influenced arguments
   - Child process module options with user-controlled cwd, env, uid

3. VM / Sandbox Escape:
   - vm.runInNewContext(userInput) — sandbox escape via constructor chain
   - vm.runInThisContext(userInput) — runs in current context
   - new Function(userInput) — equivalent to eval
   - eval(userInput) with any user data

4. Template Injection in Shell:
   - Template literals in exec(): `git log ${userBranch}`
   - process.env manipulation before child_process calls
   - Dangerous characters not sanitized ($, `, ;, &, |, >, <)

Code context:
{code}
```

## Validation Prompt

```
Node.js injection at {file}:{line}. Is user input reaching exec/eval without sanitization? Is shell: true set? Are array-form args used for spawn?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- spawn with array arguments (executable + separate args array) — safe, no shell
- execFile (no shell by default) with static command and validated args
- vm.createContext with explicit sandbox limiting prototype chain access
- Worker threads (not child_process) — no shell, different attack surface
