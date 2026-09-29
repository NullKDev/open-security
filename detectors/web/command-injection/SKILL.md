---
id: command-injection
title: Command Injection
stages:
  - llm-scan
  - validate
severity: critical
description: Detects command injection vulnerabilities where user-controlled input is passed to shell commands or process execution, allowing arbitrary command execution on the host.
classical_prepass: semgrep
classical_hint: p/command-injection
---

# Command Injection Detector

## Detection Prompt

```
Analyze the following code for command injection vulnerabilities. Look for:
- Shell command execution (exec, execSync, spawn with shell:true, system(), popen()) where arguments include user input
- Shell string interpolation with user-controlled values: `ls ${userInput}`, `rm -rf ${filename}`
- Process spawning where arguments are constructed from user input without proper escaping
- Template-based shell script generation with unvalidated parameters
- Calls to child_process.exec/execSync with concatenated strings (vs array arguments)
- eval() or similar dynamic code execution with user-influenced code strings

Key distinction: spawn(bin, [arg1, arg2]) with array form is safe; exec(`${bin} ${arg}`) is unsafe.

For each finding, identify:
1. The user-controlled input
2. The shell execution sink
3. Whether string concatenation or interpolation is used vs. array arguments
4. Whether input is validated or escaped before use

Code context:
{code}
```

## Validation Prompt

```
A potential command injection vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is user input included in the command string (not just as a separate array argument)?
2. Is the spawn call using shell: true or exec (which uses a shell)?
3. Is user input validated/allowlisted before use?
4. Are shell metacharacters stripped or escaped?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- `spawn(bin, [arg1, userInput], { shell: false })` is safe — no shell interpretation
- Commands with only hardcoded arguments and no user-controlled parts are safe
- Arguments that are strictly numeric or match a closed enum/allowlist are low risk
- Admin-only CLI tools with strong authentication have reduced exposure
