---
id: dockerfile-misconfig
title: Dockerfile Security Misconfiguration
stages: [llm-scan, validate]
severity: high
description: Detects Dockerfile security issues — root user, ADD vs COPY, exposed secrets, unverified base images, and missing security best practices.
classical_prepass: semgrep
---

# Dockerfile Security Misconfig

## Detection Prompt

```
Analyze Dockerfiles for security misconfigurations. Look for:

1. Root User:
   - Missing USER directive (container runs as root)
   - USER root at the end of Dockerfile
   - No user creation in the image

2. ADD vs COPY:
   - ADD used instead of COPY (ADD can fetch URLs and extract archives)
   - ADD with remote URLs (arbitrary file download during build)

3. Exposed Secrets:
   - ARG with secret values (persist in image layers)
   - ENV with passwords, tokens, API keys
   - RUN echo $SECRET > /app/config (secret in layer history)
   - COPY .env /app/ — copying environment file with secrets

4. Insecure Package Installation:
   - pip install without --no-cache-dir (cache contains packages with CVEs)
   - apt-get install without cleanup (rm -rf /var/lib/apt/lists/*)
   - npm install -g without --production (dev dependencies in prod)
   - curl | bash patterns (unverified remote script execution)

5. Base Image Risks:
   - FROM with :latest tag (unpinned, can change)
   - FROM with unverified third-party images
   - Missing image digest pinning (FROM image@sha256:...)
   - Using deprecated/minimal-security images

Code context:
{code}
```

## Validation Prompt

```
Dockerfile misconfig at {file}:{line}. Is root user intentional or can it be changed? Are ARG values truly secrets? Is the base image from a trusted registry?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Multi-stage builds where final stage uses non-root USER
- ADD for local files (equivalent to COPY) — acceptable but prefer COPY
- ARG for build-time versions (not secrets) — safe
- :latest tag with official images from Docker Hub (debian, alpine, node) — widely accepted
