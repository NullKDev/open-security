# CVE Hunt: Remote Code Execution — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the RCE vulnerability described in {{cveId}}.

## Advisory Steps

1. **Find code execution sinks**: Locate `eval`, `exec`, `spawn`, `execFile`, `child_process`, `vm.runInNewContext`, template engines with code eval.
2. **Trace user input**: Follow user-controlled data to any code execution sinks.
3. **Assess command construction**: Review shell command construction — confirm user input is not interpolated directly.
4. **Check argument sanitization**: Verify that arguments passed to `spawn`/`execFile` are validated and allowlisted.
5. **Review deserialization paths**: Check for deserialization that can trigger code execution via gadget chains.

{{pocUrl}}

## Advisory Summary
{{summary}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
