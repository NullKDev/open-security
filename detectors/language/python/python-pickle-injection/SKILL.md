---
id: python-pickle-injection
title: Python Pickle / Insecure Deserialization
stages:
  - llm-scan
  - validate
severity: critical
description: Detects Python insecure deserialization vulnerabilities — pickle.loads with untrusted input, yaml.load without SafeLoader, marshal.loads, and other deserialization patterns that enable arbitrary code execution.
classical_prepass: semgrep
classical_hint: p/python
---

# Python Pickle / Insecure Deserialization Detector

## Detection Prompt

```
Analyze Python code for insecure deserialization vulnerabilities. Look for:

1. Pickle with Untrusted Input:
   - pickle.load(file) / pickle.loads(data) where data comes from user input
   - cPickle used with network data, cookies, file uploads
   - Shelve / dbm with pickle protocol from untrusted sources
   - dill.loads with user-controlled input

2. Unsafe YAML Loading:
   - yaml.load(userInput) without Loader=yaml.SafeLoader
   - yaml.full_load() — not safe in all PyYAML versions
   - ruamel.yaml with unsafe constructors

3. Other Unsafe Deserialization:
   - marshal.loads(userBytes) — can execute arbitrary code
   - torch.load(modelPath) from user-controlled paths (TensorFlow pickle)
   - joblib.load from untrusted files (uses pickle internally)
   - pandas.read_pickle with user-controlled file paths
   - numpy.load with allow_pickle=True on untrusted files

4. Dynamic Code Loading:
   - importlib.import_module with user-controlled module names
   - __import__() with user input
   - exec() / eval() / compile() with user-controlled source
   - ast.literal_eval misused (actually eval'ing, not just literals)

For each finding, identify the deserialization function, the source of untrusted input, and the impact (RCE, data tampering).

Code context:
{code}
```

## Validation Prompt

```
A potential Python insecure deserialization was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the deserialized data truly from an untrusted source (user input, network, external file)?
2. Is there any sanitization or safe loading pattern applied?
3. Would exploitation allow arbitrary code execution in the application's context?
4. Is the deserialization in a test file, development script, or production path?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- pickle.load from application-internal cache files (trusted source, not user-controlled)
- yaml.safe_load() — explicitly uses SafeLoader, not vulnerable
- torch.load in ML training code loading known model weights (not user uploads)
- pickle used for IPC between trusted processes (same machine, same user)
- Test files that intentionally test deserialization with known-safe data
