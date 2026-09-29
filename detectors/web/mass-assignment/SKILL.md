---
id: mass-assignment
title: Mass Assignment / Auto-binding
stages:
  - llm-scan
  - validate
severity: high
description: Detects mass assignment vulnerabilities where request body properties are automatically bound to model fields without an allowlist, enabling attackers to set sensitive fields like isAdmin, role, or isVerified.
classical_prepass: semgrep
classical_hint: p/owasp-top-ten
---

# Mass Assignment Detector

## Detection Prompt

```
Analyze the following code for mass assignment / auto-binding vulnerabilities. Look for:

1. Automatic Model Binding without Allowlists:
   - Object spread from request body to model (...req.body)
   - ORM create/update with entire request body (Model.create(req.body))
   - req.body passed directly to database insert/update operations
   - GraphQL mutations with input types that expose sensitive fields

2. Sensitive Fields Exposed to Binding:
   - isAdmin, role, permissions, isVerified, accountType fields
   - balance, credits, subscriptionTier fields settable via request
   - Foreign keys or ownership fields (userId, organizationId) from request

3. Framework-Specific Patterns:
   - Express: req.body spread into Mongoose/Sequelize/Prisma create/update
   - Laravel: $request->all() in Model::create() without $fillable/$guarded
   - Rails: params.require().permit() missing or using permit! (allow all)
   - Django: ModelForm without fields or exclude configuration
   - Spring: @ModelAttribute without validation or DTO mapping

For each finding, identify:
1. Which request body properties reach the model
2. Which sensitive fields could be overwritten
3. What allowlist (if any) is missing
4. File and line number

Code context:
{code}
```

## Validation Prompt

```
A potential mass assignment vulnerability was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the request body passed directly to model creation/update without field filtering?
2. Are there sensitive fields (role, isAdmin, permissions) that could be overwritten?
3. Is there an allowlist ($fillable in Laravel, .permit in Rails, DTO mapping in Spring)?
4. Does a middleware or transformer strip unwanted fields before reaching this code?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- DTO/ViewModel classes that explicitly map only allowed fields
- GraphQL input types with explicit field definitions (not generic JSON)
- Zod/Joi validation schemas that strip unknown fields before reaching the model
- ORM operations with explicit field selection (Prisma select, Sequelize attributes)
- Form libraries that validate and whitelist fields server-side
