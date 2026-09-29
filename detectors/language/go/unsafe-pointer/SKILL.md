---
id: go-unsafe-pointer
title: Go Unsafe Pointer / Memory Safety
stages: [llm-scan, validate]
severity: high
description: Detects unsafe Go patterns — unsafe.Pointer misuse, cgo without validation, race conditions, and unbounded goroutine creation from user input.
classical_prepass: semgrep
classical_hint: p/golang
---

# Go Unsafe Pointer Detector

## Detection Prompt

```
Analyze Go code for memory safety and concurrency issues. Look for:

1. Unsafe Package Misuse:
   - unsafe.Pointer conversions without proper bounds checking
   - unsafe.Slice / unsafe.String with arbitrary pointers
   - Pointer arithmetic via uintptr (vulnerable to GC relocation)
   - cgo calls with unvalidated pointers from C

2. Race Conditions:
   - Shared state without sync.Mutex / sync.RWMutex
   - Map reads/writes without synchronization (go map is not goroutine-safe)
   - sync.Once misuse (calling Do from within Do)
   - Data races on package-level variables

3. Goroutine Leaks:
   - Unbounded go func() calls from user input (e.g., per-request goroutine without pool)
   - Channels without close causing goroutines to block forever
   - select without default or context cancellation

4. Nil Pointer / Panic:
   - Interface nil vs concrete nil confusion
   - defer recover without checking error type
   - Missing nil checks on returned errors before dereferencing

Code context:
{code}
```

## Validation Prompt

```
Go unsafe pattern at {file}:{line}. Is this performance-critical code requiring unsafe? Is there a sync mechanism protecting shared state? Are goroutines bounded or cancellable?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Low-level standard library code (syscall, reflect) using unsafe by necessity
- sync.Pool managing goroutine reuse (intentional, bounded)
- Benchmark/test code with intentional race conditions for measurement
- cgo with well-documented and validated C interop patterns
