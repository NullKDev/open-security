---
id: malicious-package-hooks
title: Malicious Package Install Hooks and Supply Chain Attacks
stages: [llm-scan, validate]
severity: critical
description: Detects malicious package install hooks, typosquatted dependencies, postinstall scripts that download/execute code, and supply chain attack vectors in npm, pip, gradle, maven, cargo, and gem ecosystems.
---

# Malicious Package Hooks and Supply Chain Attacks

## Detection Prompt

You are a supply chain security specialist. Open and read the actual package manifests. This domain requires reading specific files.

### Step 1: Read package.json (Node/npm)
Open `package.json`. Inspect the `scripts` field for:
- `preinstall`, `postinstall`, `prepare`, `prepack` — executed automatically during `npm install`
- Scripts containing: `curl`, `wget`, `fetch`, `axios.get`, `http.get`, `child_process.exec`, `spawn`, `eval`, `Function(`, `require('child_process')`, `execSync`
- Scripts that pipe to `sh` or `bash`: `curl https://... | bash`, `wget -O- ... | sh`
- Scripts that write to `~/.bashrc`, `~/.profile`, `/etc/hosts`, or cron jobs
- Scripts that read environment variables and send them: `process.env` → external HTTP call

Also read `package-lock.json` or `yarn.lock` and check:
- Dependencies with identical names to popular packages but different capitalizations (`Lodash` vs `lodash`, `expres` vs `express`)
- Recently added transitive dependencies with very low download counts
- Dependencies pointing to git repositories instead of registry: `"evil-lib": "git+https://github.com/attacker/evil-lib"`

### Step 2: Read build.gradle / build.gradle.kts (Android/Java)
Open gradle files. Check:
- `repositories { maven { url "http://..." } }` — non-HTTPS Maven repo (MitM)
- `repositories { maven { url "..." } }` pointing to non-standard repositories
- `apply from: "https://..."` — downloading and executing remote Gradle script
- Gradle plugins with low community adoption applied in the build
- `exec { commandLine "curl", "...", "-o", "..." }` — downloading code during build

### Step 3: Read setup.py / pyproject.toml (Python)
In `setup.py`:
- `subprocess.call()`, `os.system()`, `subprocess.Popen()` in the setup script body
- `install_requires` pointing to git URLs: `git+https://github.com/...`
- Post-install scripts that download additional code via `urllib` or `requests`
- `cmdclass` overrides for `install` that execute arbitrary code

In `pyproject.toml`:
- Build backends that are not well-known (`setuptools`, `poetry`, `hatch`, `flit`)

### Step 4: Read Cargo.toml (Rust)
- Look for `build = "build.rs"` — then open `build.rs` and read it
- `build.rs` making network calls: `reqwest`, `ureq`, `curl` crates used in build scripts
- `build.rs` executing shell commands: `Command::new("curl")`, `Command::new("wget")`
- `build.rs` writing to locations outside the build directory

### Step 5: Check for Dependency Confusion Attacks
Read `package.json`, `requirements.txt`, `pom.xml`, `build.gradle`:
- Internal package names published to public registries (attackers can shadow internal packages)
- Scoped packages (`@company/internal-lib`) without registry lock to private registry
- `npm config get registry` — is it pointing to the company's private registry for internal packages?

### Step 6: Check GitHub Actions and CI/CD
Open `.github/workflows/*.yml`:
- Actions pinned to `@master`, `@latest`, `@main` instead of `@sha256:...` or `@v1.2.3`
- `actions/checkout@v3` without pinning (OK) vs `some-unknown-action@main` (flag)
- Third-party actions with low star counts used in privileged jobs
- `run: curl https://... | bash` in workflow steps
- `env:` blocks exposing secrets to scripts that don't need them

## Validation Prompt

Potential malicious package hook or supply chain attack at {file}:{line}.

Evaluate:
1. Is this a legitimate build step (prisma generate, husky install, native compilation)?
2. Does the script make network calls to untrusted domains?
3. Is the dependency a well-known package or a potential typosquat?
4. What data could be exfiltrated by this hook (env vars, source code, credentials)?

Respond: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}

## FP Heuristics

- `postinstall: "prisma generate"` — legitimate ORM codegen
- `postinstall: "husky install"` — legitimate git hooks setup
- `build.rs` in well-known crates (openssl-sys, ring) — standard native compilation
- `actions/setup-node@v3` or other official GitHub actions — trusted, pinned to version
- `apply from: "gradle/dependencies.gradle"` pointing to a local file — safe
