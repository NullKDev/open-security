# CVE Hunt: Security Vulnerability — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Understand the vulnerability**: Read the advisory details carefully and identify the vulnerable component, affected versions, and exploitation conditions.
2. **Search for vulnerable patterns**: Look for code patterns that match the vulnerability description.
3. **Assess version exposure**: Check dependency versions and compare against affected ranges.
4. **Review mitigations**: Determine if any documented mitigations are already in place.
5. **Test exploitation path**: Trace the minimal exploit path and assess whether it is reachable in this codebase.

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
