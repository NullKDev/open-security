---
id: k8s-misconfig
title: Kubernetes Security Misconfiguration
stages: [llm-scan, validate]
severity: high
description: Detects Kubernetes security misconfigurations — privileged containers, root users, hostPath volumes, host network/PID, and missing security contexts.
classical_prepass: semgrep
---

# Kubernetes Security Misconfig

## Detection Prompt

```
Analyze Kubernetes manifests for security misconfigurations. Look for:

1. Privileged Containers:
   - securityContext.privileged: true
   - containers running as root (runAsUser: 0 or runAsNonRoot: false)
   - allowPrivilegeEscalation: true
   - SYS_ADMIN, NET_ADMIN, SYS_PTRACE capabilities

2. Host Resource Access:
   - hostPath volumes mounting sensitive paths (/var/run/docker.sock, /etc/kubernetes, /proc)
   - hostNetwork: true (container shares host network namespace)
   - hostPID: true (container sees host processes)
   - hostIPC: true (container shares host IPC)

3. Missing Security Controls:
   - No resource limits/requests (CPU, memory) — DoS risk
   - No readOnlyRootFilesystem (container can write to root fs)
   - No seccomp profile, AppArmor, or SELinux configuration
   - ImagePullPolicy: Always without image digest pinning

4. RBAC Misconfig:
   - ClusterRoleBindings to default service accounts
   - Roles/clusterroles with wildcard verbs/resources
   - Service accounts with cluster-admin role
   - Anonymous access enabled (--anonymous-auth=true)

Code context:
{code}
```

## Validation Prompt

```
K8s misconfig at {file}:{line}. Is privileged access truly needed? Is this a system component or user workload? Are compensating controls in place (PodSecurityPolicy, admission webhooks)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- System components (kube-proxy, CNI plugins, storage drivers) requiring privileged access
- Init containers that need privileged for setup (then drop to non-root)
- Debug/Ephemeral containers with intentionally broad access
- Namespace-scoped RBAC with limited impact
