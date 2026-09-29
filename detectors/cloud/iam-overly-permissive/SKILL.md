---
id: iam-overly-permissive
title: IAM Overly Permissive Roles
stages: [llm-scan, validate]
severity: high
description: Detects overly permissive IAM policies in cloud configurations — wildcard actions/resources, admin roles on compute instances, and excessive cross-account access.
classical_prepass: semgrep
---

# IAM Overly Permissive Roles

## Detection Prompt

```
Analyze cloud IAM configurations for overly permissive policies. Look for:

1. Wildcard Permissions:
   - Action: '*' or Action: ['*'] with Resource: '*'
   - 's3:*' on all buckets, 'dynamodb:*' on all tables
   - 'iam:*' or 'ec2:*' on any resource
   - NotAction combined with Resource wildcard (effectively allows everything except)

2. Excessive Compute Roles:
   - Lambda execution roles with AdministratorAccess
   - EC2 instance profiles with full S3, DynamoDB, RDS access
   - ECS task roles with wildcard permissions
   - EKS node roles with cluster admin access

3. Cross-Account Access:
   - Principal: '*' or Principal: { AWS: '*' } in trust policies
   - sts:AssumeRole with external accounts without ExternalId condition
   - Public S3 bucket policies with Principal: '*'

4. Terraform / IaC Patterns:
   - aws_iam_role_policy with wildcard actions
   - aws_iam_policy_document statements with Effect: Allow + Action: '*'
   - Missing condition blocks on broad permissions

Code context:
{code}
```

## Validation Prompt

```
Overly permissive IAM at {file}:{line}. Is wildcard Action: '*' really needed? Are there condition blocks restricting access? Is this policy attached to production resources?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- ReadOnlyAccess policies with Resource: '*' — intended to be broad for monitoring
- Policies with condition blocks narrowing scope (PrincipalTag, SourceVpc, SourceArn)
- Service-linked roles managed by AWS (cannot be modified)
- Test/development accounts with intentionally broad policies
