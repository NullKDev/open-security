# CVE Hunt: Injection Vulnerability — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the injection vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Identify injection sinks**: Search for database queries, command executions, and template rendering that accept user-controlled input without proper sanitization.
2. **Trace data flow**: Follow input from entry points (API handlers, form submissions) to potential injection sinks.
3. **Check parameterization**: Verify that all queries use parameterized statements or prepared statements, not string concatenation.
4. **Assess escaping**: Review any escaping logic — confirm it is applied consistently and uses the correct escaping function for the context.
5. **Test patterns**: Look for patterns matching known exploitation techniques for this CVE class.

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
