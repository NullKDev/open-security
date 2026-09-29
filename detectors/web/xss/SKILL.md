---
id: xss
title: Cross-Site Scripting (XSS)
stages:
  - llm-scan
  - validate
severity: high
description: Detects XSS vulnerabilities where user-supplied content reaches HTML rendering sinks without proper encoding — covering reflected, stored, and DOM-based variants across server-side and client-side frameworks.
classical_prepass: semgrep
classical_hint: p/xss
---

# Cross-Site Scripting (XSS) Detector

## Detection Prompt

```
You are hunting for Cross-Site Scripting (XSS) vulnerabilities. Do NOT just scan for keywords — trace actual data flows from untrusted input sources to HTML rendering sinks.

STEP 1 — Open entry-point files first:
- Express/Koa/Fastify: open route files (routes/, controllers/, handlers/)
- Next.js: open pages/, app/, api/ directories
- Django/Flask: open views.py, templates/*.html files
- Java Spring: open @Controller / @RestController classes
- PHP: open index.php, all *.php files

STEP 2 — Identify all user-controlled sources in those files:
  JavaScript: req.query.*, req.params.*, req.body.*, req.headers.*, document.location, document.URL, location.hash, location.search, window.name, document.referrer, postMessage event.data
  Python: request.args.get(), request.form.get(), request.json, request.GET[], request.POST[]
  PHP: $_GET[], $_POST[], $_REQUEST[], $_COOKIE[], $_SERVER['HTTP_*']
  Java: request.getParameter(), request.getHeader(), PathVariable, RequestParam

STEP 3 — Follow those variables to HTML rendering sinks:

SERVER-SIDE SINKS (any framework):
  - String concatenation into HTML: `"<div>" + userInput + "</div>"` — ALWAYS vulnerable
  - Template interpolation without auto-escaping:
    - Jinja2: {{ value | safe }} or {%- autoescape false %}
    - Twig: {{ value | raw }}
    - Handlebars: {{{ value }}} (triple braces)
    - ERB: <%== value %> (double equals)
    - Thymeleaf: th:utext (vs safe th:text)
    - Blade: {!! value !!}
  - res.send() / res.write() with user data embedded in HTML strings

DOM-BASED SINKS:
  - element.innerHTML = userInput
  - element.outerHTML = userInput
  - document.write(userInput)
  - document.writeln(userInput)
  - element.insertAdjacentHTML('beforeend', userInput)
  - $.html(userInput), $(userInput) in jQuery
  - eval(userInput), setTimeout(userInput, n), setInterval(userInput, n)
  - location.href = userInput (if starts with javascript:)
  - element.src = userInput, element.href = userInput (javascript: protocol)

REACT/VUE/ANGULAR — look specifically for escape bypasses:
  - React: dangerouslySetInnerHTML={{ __html: userInput }}
  - Vue: v-html="userInput"
  - Angular: [innerHTML]="userInput" or bypassSecurityTrustHtml()
  - Angular: DomSanitizer.bypassSecurityTrustHtml(userInput)

STORED XSS — also check:
  - Database writes where user input is saved, then rendered later
  - Find all DB INSERT/UPDATE operations, note what fields are stored
  - Then find all SELECT + render operations for those same fields
  - If the stored value is rendered into HTML without encoding → Stored XSS

For EVERY finding, confirm: (1) the source variable name, (2) the file and line where it reaches the sink, (3) whether any encoding/sanitization function sits between source and sink.
```

## Validation Prompt

```
A potential XSS vulnerability was reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL four questions:
1. What is the exact user-controlled source? (variable name, where it comes from)
2. Does the value reach a real HTML rendering sink, or just a text/JSON/log context?
3. Is there a sanitization function applied BETWEEN the source and the sink?
   - Safe: DOMPurify.sanitize(), htmlspecialchars(), html.escape(), escapeHtml(), he.encode()
   - Also safe: React JSX {variable} without dangerouslySetInnerHTML, Angular {{ variable }} without bypassSecurityTrust*
   - UNSAFE: .replace(/<script>/g, '') or other blocklist-based filters
4. Would a CSP policy prevent execution? Check for Content-Security-Policy header in middleware.

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- React JSX `{variable}` text nodes are auto-escaped — only `dangerouslySetInnerHTML` is an XSS sink
- Angular `{{ variable }}` template interpolation is auto-escaped by default
- Jinja2 with `autoescape=True` (Django's default) is safe UNLESS `| safe` or `| Markup()` is used
- Content rendered inside JSON API responses (`Content-Type: application/json`) cannot cause XSS in browsers
- `textContent` and `innerText` assignments are safe (text-only, never parsed as HTML)
- `htmlspecialchars($var, ENT_QUOTES, 'UTF-8')` in PHP is a valid escape
- Output that passes through a validated allowlist (e.g., only rendering a user-chosen color from `['red','blue','green']`) is not exploitable
