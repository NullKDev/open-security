---
id: exposed-storage
title: Exposed Cloud Storage (S3/GCS/Azure)
stages: [llm-scan, validate]
severity: critical
description: Detects misconfigured cloud storage — public S3 buckets, GCS buckets with allUsers access, public Azure Blob containers, and storage policies allowing anonymous access.
classical_prepass: semgrep
---

# Exposed Cloud Storage

## Detection Prompt

```
Analyze cloud storage configurations for public exposure. Look for:

1. S3 Public Buckets:
   - acl = "public-read" or "public-read-write" in Terraform
   - BlockPublicAccess disabled (block_public_acls = false)
   - Bucket policies with Principal: "*" and s3:GetObject
   - Static website hosting enabled on buckets with sensitive data

2. GCS Public Buckets:
   - google_storage_bucket_iam_member with allUsers or allAuthenticatedUsers
   - Uniform bucket-level access disabled with public ACLs
   - Public object access via google_storage_bucket_object with public ACL

3. Azure Blob Containers:
   - azurerm_storage_container with container_access_type = "blob" or "container"
   - Public blob access without SAS token requirements
   - Anonymous access enabled on storage accounts

4. CDN / Edge Exposure:
   - CloudFront distributions with public origin buckets
   - Cloudflare R2 buckets with public access
   - Backblaze B2 public buckets

Code context:
{code}
```

## Validation Prompt

```
Exposed storage at {file}:{line}. Is the bucket/container truly public-readable? Does it contain sensitive data? Is public access intentional (CDN, static site)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Public buckets for static website hosting (intentional)
- CDN origin buckets with CloudFront OAI restricting direct access
- Buckets with public-read ACL but bucket policy restricting to specific referrers
- Empty buckets or buckets with only public assets (images, CSS, JS)
