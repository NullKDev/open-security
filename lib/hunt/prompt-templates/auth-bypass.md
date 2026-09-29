# CVE Hunt: Authentication Bypass — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the authentication bypass described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Map auth checkpoints**: Locate all authentication and authorization checks — middleware, route guards, session validation.
2. **Identify bypass paths**: Look for unprotected routes, missing middleware, or conditions where checks can be skipped.
3. **Assess token validation**: Verify JWT/session token validation is strict (algorithm pinning, expiry checks, signature verification).
4. **Review input handling**: Check if user-supplied inputs can influence auth decisions (e.g., type juggling, null bytes, header injection).
5. **Test edge cases**: Consider empty credentials, malformed tokens, and race conditions.

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
