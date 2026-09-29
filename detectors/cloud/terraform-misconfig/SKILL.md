---
id: terraform-misconfig
title: Terraform / IaC Security Misconfig
stages: [llm-scan, validate]
severity: high
description: Detects security misconfigurations in Terraform and Infrastructure-as-Code — open security groups, hardcoded secrets, unencrypted resources, and public database instances.
classical_prepass: semgrep
---

# Terraform / IaC Security Misconfig

## Detection Prompt

```
Analyze Terraform/OpenTofu/Pulumi code for security misconfigurations. Look for:

1. Open Security Groups:
   - cidr_blocks = ["0.0.0.0/0"] on SSH (22), RDP (3389), DB ports (3306, 5432, 27017)
   - Security group rules allowing all traffic (from_port 0, to_port 0, protocol "-1")
   - Egress rules allowing all outbound (0.0.0.0/0)

2. Hardcoded Secrets in IaC:
   - Password/sensitive values in .tf files instead of variables
   - tfvars files with real credentials committed
   - provider blocks with hardcoded access_key/secret_key
   - Local values with sensitive strings

3. Unencrypted Resources:
   - RDS instances with storage_encrypted = false
   - EBS volumes with encrypted = false
   - S3 buckets without server_side_encryption_configuration
   - EFS without encrypted = true
   - ElastiCache without at_rest_encryption_enabled

4. Public Database / Service Instances:
   - publicly_accessible = true on RDS
   - DB instances in public subnets
   - Redshift clusters with publicly_accessible = true
   - Elasticsearch/OpenSearch with public endpoint

Code context:
{code}
```

## Validation Prompt

```
Terraform misconfig at {file}:{line}. Is 0.0.0.0/0 really open to the internet? Is encryption disabled on production data? Are these dev/test resources?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Dev/staging environments with intentionally open security groups
- 0.0.0.0/0 with security group referencing (allowed only from another SG)
- Load balancer security groups (must accept 0.0.0.0/0 for public traffic)
- Variables with sensible defaults in variables.tf (not secrets)
