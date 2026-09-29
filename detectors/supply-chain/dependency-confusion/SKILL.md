---
id: dependency-confusion
title: Dependency Confusion / Substitution Attack
stages: [llm-scan, validate]
severity: high
description: Detects dependency confusion vulnerabilities where private package names are resolvable from public registries due to missing scoped registry configuration, enabling attackers to hijack internal packages.
classical_prepass: osv-scanner
---

# Dependency Confusion Detector

## Detection Prompt

```
You are hunting for dependency confusion vulnerabilities. The attack: if a company uses internal package names (e.g., @mycompany/auth-service) but does NOT configure npm to fetch that scope from a private registry, an attacker can publish a package with the SAME name to npm and it will be installed instead.

STEP 1 — Identify internal/private package references:

Open package.json (npm), requirements.txt / pyproject.toml / Pipfile (pip), go.mod (Go), pom.xml / build.gradle (Maven/Gradle), Gemfile (Ruby), *.csproj (NuGet), Cargo.toml (Rust)

Look for packages that appear internal:
  - Company-scoped npm packages: @acme/*, @mycompany/*, @internal/*
  - Hyphenated internal names: my-company-internal-lib, acme-shared-utils, internal-auth
  - Python packages with company prefix: mycompany_core, acme_utils
  - Go modules with internal paths: github.com/mycompany/private-repo, go.mycompany.com/internal
  - NuGet packages: MyCompany.Internal.Auth, Acme.Shared.Utils
  - Maven groupId matching internal domains: com.mycompany.internal, io.mycompany.core

Signs a package is likely internal (not public):
  - Package name contains the company name or obvious internal identifiers
  - Package has no corresponding public repository on npm/PyPI/crates.io
  - Package name appears in internal documentation references
  - Low version numbers (0.1.0, 1.0.0-internal, 0.0.1-snapshot)

STEP 2 — Check if private registry is configured for each package manager:

NPM (.npmrc, package.json publishConfig, .yarnrc.yml):
  VULNERABLE: @mycompany/auth in package.json with NO corresponding .npmrc entry like:
    @mycompany:registry=https://npm.mycompany.com
  ALSO CHECK: npm_config_registry or registry in .npmrc — does it override globally or only for specific scopes?
  VULNERABLE config: --extra-registry pointing to private first but npm fallback still enabled
  Check all: .npmrc, .yarnrc, .yarnrc.yml, package.json publishConfig

  Safe: @mycompany:registry=https://registry.mycompany.com in .npmrc (scope-specific)
  Safe: publishConfig.registry set in internal package's own package.json

pip (pip.conf, pip.ini, setup.cfg, pyproject.toml):
  VULNERABLE: requirements.txt lists mycompany-auth without --index-url or --extra-index-url pointing to private PyPI
  VULNERABLE: --extra-index-url https://private.pypi.com (extra means BOTH registries are checked — public wins if attacker published)
  Safe: --index-url https://private.pypi.com/simple (replaces public, not augments)
  Check: pip.conf, ~/.pip/pip.conf, setup.cfg [tool:pip] section, pyproject.toml [tool.pip] section

Go (go.mod, .gitconfig, GOENV, .goenv):
  VULNERABLE: go.mod imports mycompany.com/internal/auth without GOPRIVATE=mycompany.com configured
  Check for: GOPRIVATE, GONOSUMCHECK, GONOSUMDB, GOPROXY env vars
  In CI pipelines: are these set in .github/workflows, .gitlab-ci.yml, Jenkinsfile?
  Safe: GOPRIVATE=*.mycompany.com,mycompany.com or GOPROXY=https://goproxy.mycompany.com,direct

Maven/Gradle:
  VULNERABLE: <dependency><groupId>com.mycompany.internal</groupId>... in pom.xml without private repo declared FIRST
  Check: pom.xml <repositories>, settings.xml <mirrors>, build.gradle repositories block
  VULNERABLE: Public Central comes before private Nexus/Artifactory in repository order

NuGet (.csproj, nuget.config):
  VULNERABLE: <PackageReference Include="MyCompany.Internal.*" .../> without private source in nuget.config
  Check: nuget.config <packageSources> — is the private source listed and is it the default?

STEP 3 — Check CI/CD pipelines for registry configuration:

Open: .github/workflows/*.yml, .gitlab-ci.yml, Jenkinsfile, .circleci/config.yml, azure-pipelines.yml

  Does the CI set NPM_TOKEN pointing to private registry before npm install?
  Does the CI configure pip to use private index before pip install?
  Does the CI set GOPRIVATE, GONOSUMCHECK before go build?
  Is the registry authentication done via env secrets or hardcoded?

STEP 4 — Check if internal packages have been "namespace-squatted" on public registries:

  Flag any scoped package (@mycompany/*) where the scope is NOT registered to the company on npm
  Internal-looking package names with version 0.0.1 or 1.0.0 that appear suspicious

Report: package name, file where it's referenced, which registry configuration is missing, and what an attacker could do (publish malicious package to npm/PyPI with the same name to get it installed in CI)
```

## Validation Prompt

```
Dependency confusion risk at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. Is the package name genuinely internal/private, or is it a known public package?
2. Is there a corresponding private registry entry in .npmrc / pip.conf / go.mod GOPRIVATE / etc. that scopes this package to the private registry?
3. For npm: is the scope (@mycompany) bound to a private registry, or does it fall back to the public npm registry?
4. For pip: is --index-url (replacing public) used, or --extra-index-url (augmenting public — still vulnerable)?
5. If the attacker published a package with the same name to the public registry, would CI/CD systems install it?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Fully public open-source projects where ALL dependencies are public packages — no dependency confusion risk
- npm scoped packages where the scope IS the company name AND .npmrc binds `@scope:registry` to a private URL — safe
- Go modules with `GOPRIVATE=*.mycompany.com` configured in CI environment variables — safe
- Maven projects where the private Nexus/Artifactory is listed BEFORE Maven Central in pom.xml repositories — safe
- NuGet with private source configured as `<packageSources>` with private-only source — safe
- Packages from well-known public scopes (@types/, @babel/, @angular/) — these are always public
