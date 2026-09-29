---
id: ssrf
title: Server-Side Request Forgery (SSRF)
stages:
  - llm-scan
  - validate
severity: high
description: Detects SSRF vulnerabilities where user-controlled URLs or hostnames drive outbound HTTP requests, enabling attackers to reach internal services, cloud metadata endpoints, or perform port scanning.
classical_prepass: semgrep
classical_hint: p/owasp-top-ten
---

# Server-Side Request Forgery (SSRF) Detector

## Detection Prompt

```
You are hunting for Server-Side Request Forgery (SSRF). The attack: an attacker supplies a URL pointing to an internal service (169.254.169.254 for AWS metadata, 127.0.0.1, internal hostnames) and the server makes a request there on their behalf.

STEP 1 — Find all outbound HTTP client calls in the codebase:

JavaScript/TypeScript:
  fetch(url), axios.get(url), axios.post(url), axios(url), got(url)
  http.request(url), https.request(url), node-fetch(url), superagent.get(url)
  request(url), needle.get(url), urllib.request(url)

Python:
  requests.get(url), requests.post(url), httpx.get(url), httpx.AsyncClient().get(url)
  urllib.request.urlopen(url), urllib2.urlopen(url), http.client.HTTPConnection(host)
  aiohttp.ClientSession().get(url)

Java:
  new URL(url).openConnection(), HttpClient.newHttpClient().send(request, ...)
  RestTemplate.getForObject(url, ...), WebClient.create(url).get()
  OkHttpClient().newCall(request).execute()

Go:
  http.Get(url), http.Post(url), http.NewRequest("GET", url, nil)
  http.DefaultClient.Do(req)

PHP:
  curl_setopt($ch, CURLOPT_URL, $url), file_get_contents($url)
  fopen($url, 'r'), Http::get($url)

STEP 2 — For each HTTP call, trace the URL argument back to its source:
  VULNERABLE if URL or hostname comes from ANY of:
  - req.query.url, req.body.url, req.body.webhook, req.body.imageUrl, req.body.endpoint
  - req.params.host, req.headers['x-forwarded-host'], req.headers['x-target']
  - User-supplied configuration stored in DB and later used as-is
  - URL extracted from user-uploaded files (XML, SVG, HTML)

  ESPECIALLY dangerous features to audit:
  - "Import from URL" / "Fetch by link" features
  - Webhook delivery endpoints (user registers a URL, server POSTs to it)
  - Image/avatar fetch by URL (proxy functionality)
  - PDF/screenshot generation from user-supplied URL
  - Health check or ping endpoints that accept a target URL
  - Integration/connector features (Slack webhooks, Zapier callbacks)

STEP 3 — Check if there is an allowlist or block:
  WEAK/BYPASSABLE — flag these:
    url.startsWith('https://') — attacker can use https://internal-host/
    /^https?:\/\//.test(url) — allows any http/https scheme
    url.includes('localhost') — bypassed with 0x7f000001, 127.1, 0177.0.0.1
    IP blocklist without hostname resolution — DNS rebinding bypasses this
    Regex that doesn't handle URL encoding (127%2e0%2e0%2e1)

  STRONG (reduce risk significantly):
    Exact allowlist of known external hostnames: ['api.stripe.com', 'hooks.slack.com']
    Parsing URL, resolving hostname to IP, then checking IP against RFC1918 ranges
    Blocking 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8

STEP 4 — Check redirect following:
  If the HTTP client follows redirects (default for most clients), an attacker can redirect from an allowed external URL to an internal IP. Check:
  - axios: no redirects disabled by default
  - fetch: no redirect handling by default (follows up to 20)
  - requests (Python): allow_redirects=True by default
  Flag if redirects are followed and redirect destination is not re-validated
```

## Validation Prompt

```
A potential SSRF was reported at {file}:{line}.

Snippet:
{snippet}

Answer these questions:
1. What is the exact source of the URL/hostname? (trace back to the HTTP request or user input)
2. Is there any allowlist validation? If yes, paste the exact allowlist check — is it bypassable?
3. Are private IP ranges explicitly blocked AFTER DNS resolution (not just string matching)?
4. Does the HTTP client follow redirects? If so, are redirect destinations re-validated?
5. What would an attacker gain by pointing this to 169.254.169.254 (AWS metadata) or 127.0.0.1?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- HTTP calls to fully hardcoded URLs with zero user-controlled components are safe (e.g., `fetch('https://api.stripe.com/v1/charges')`)
- API proxy calls where ONLY the path is user-controlled but the host is hardcoded (e.g., `fetch('https://api.example.com/' + req.params.path)`) — SSRF is not possible, but path traversal/IDORs may still be present
- Webhooks that only accept pre-registered URLs (registered at account setup, verified by admin) have significantly reduced risk
- OAuth redirect_uri to pre-registered URIs is not SSRF
- Internal health check tools that call internal services by design and are not accessible externally have reduced real-world impact
