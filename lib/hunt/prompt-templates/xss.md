# CVE Hunt: Cross-Site Scripting (XSS) — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the XSS vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Find output sinks**: Locate all places where user data is rendered into HTML — `innerHTML`, `dangerouslySetInnerHTML`, template literals in HTML context.
2. **Assess escaping**: Verify that HTML escaping is applied at every output point for user-controlled data.
3. **Check CSP**: Review Content Security Policy headers — assess whether inline script execution is blocked.
4. **Review DOM sinks**: Identify DOM-based XSS vectors: `document.write`, `location.href`, `eval(location.hash)`.
5. **Test encoding contexts**: Confirm that encoding is appropriate for the context (HTML, JS, URL, CSS).

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
