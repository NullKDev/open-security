# CVE Hunt: SSRF Vulnerability — {{cveId}}

## Objective
Determine whether the codebase at `{{targetPath}}` is affected by the server-side request forgery vulnerability described in {{cveId}}.

## Advisory Summary
{{summary}}

## Analysis Steps

1. **Find outbound HTTP calls**: Locate all `fetch`, `axios`, `http.request`, `curl`, and similar HTTP client usage.
2. **Trace URL construction**: Follow user-controlled data into URL building — identify where external URLs can be influenced.
3. **Check allowlists**: Verify that a URL allowlist or SSRF filter is applied before making any outbound requests.
4. **Assess metadata endpoints**: Check for access to cloud metadata services (169.254.169.254, fd00:ec2::254) without explicit blocking.
5. **Review redirect handling**: Determine if open redirects could be chained with SSRF.

{{pocUrl}}

## Verdict
After analysis, determine: **exposed** | **not-exposed** | **indeterminate**
