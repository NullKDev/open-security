---
id: electron-config
title: Electron Security Misconfiguration
stages: [llm-scan, validate]
severity: high
description: Detects insecure Electron configurations — nodeIntegration enabled without contextIsolation, missing sandbox, disabled webSecurity, and unsafe IPC patterns.
classical_prepass: semgrep
---

# Electron Security Misconfig Detector

## Detection Prompt

```
Analyze Electron app code for security misconfigurations. Look for:

1. Insecure BrowserWindow Options:
   - nodeIntegration: true without contextIsolation: true
   - contextIsolation: false (default in old Electron, dangerous)
   - sandbox: false (renderer has full Node.js access)
   - webSecurity: false (disables same-origin policy)
   - allowRunningInsecureContent: true (mixed content allowed)

2. Unsafe IPC Patterns:
   - ipcMain.handle with unrestricted channel handlers
   - ipcRenderer.send with untrusted data
   - Preload scripts exposing ipcRenderer directly to renderer
   - contextBridge.exposeInMainWorld with dangerous APIs (fs, child_process, shell)

3. Insecure Content Loading:
   - loadURL with user-controlled URLs
   - allowpopups without restrictions
   - Missing Content-Security-Policy in HTML
   - File protocol loading (file://) from untrusted sources

Code context:
{code}
```

## Validation Prompt

```
Electron config at {file}:{line}. Is contextIsolation enabled? Is nodeIntegration disabled? Are preload scripts safely exposing APIs?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Electron 12+ with contextIsolation: true (default since v12) — nodeIntegration is safe when isolated
- Preload scripts using contextBridge with explicit API surface
- BrowserWindow for local-only content (built-in pages, settings)
- Dev tools configuration (not production BrowserWindow)
