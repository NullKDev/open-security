---
id: file-upload-vuln
title: File Upload Vulnerability
stages: [llm-scan, validate]
severity: high
description: Detects insecure file upload handling — missing content-type validation, no extension allowlist, zip bombs, unrestricted file size, and path traversal in upload destinations.
classical_prepass: semgrep
---

# File Upload Vulnerability Detector

## Detection Prompt

```
Analyze file upload code for vulnerabilities. Look for:

1. Missing Validation:
   - multer/busboy/formidable without fileFilter or mimetype check
   - No file extension allowlist (allowing .php, .jsp, .aspx where only images expected)
   - Missing magic bytes validation (Content-Type header can be spoofed)
   - No file size limit (DoS via multi-GB uploads)

2. Unsafe Storage:
   - Upload path using user-controlled filename (path traversal: ../../../etc/passwd)
   - Uploads stored in web-accessible directory with execute permissions
   - No filename sanitization (allowing shell metacharacters)
   - ZIP extraction without path traversal checks (Zip Slip)

3. Processing Risks:
   - Image processing libraries (ImageMagick, Sharp) with known CVEs
   - XML/PDF parsing of uploaded files (XXE, SSRF via file upload)
   - Archive extraction without size limits (Zip Bomb, Billion Laughs)
   - Polyglot file acceptance (file valid as both image and script)

Code context:
{code}
```

## Validation Prompt

```
File upload at {file}:{line}. Is content-type validated? Are extensions allowed? Is the upload path sanitized? Are there size limits?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Server generates filename (UUID) — no user-controlled path
- File stored in CDN/object storage (S3) — not web-accessible directly
- Image processing with well-maintained library and size limits
- Upload validation at the API gateway / WAF level
