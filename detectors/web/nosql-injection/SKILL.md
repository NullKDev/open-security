---
id: nosql-injection
title: NoSQL Injection
stages:
  - llm-scan
  - validate
severity: critical
description: Detects NoSQL injection vulnerabilities in MongoDB, CouchDB, and other NoSQL databases where user input is passed unsanitized into query operators ($where, $regex, $ne, $gt) or eval-like functions.
classical_prepass: semgrep
classical_hint: p/nosql-injection
---

# NoSQL Injection Detector

## Detection Prompt

```
Analyze the following code for NoSQL injection vulnerabilities. Look for:

1. MongoDB Operator Injection:
   - User input containing $ operators ($where, $regex, $ne, $gt, $expr) reaching queries
   - req.body, req.query, req.params passed directly to collection.find(), findOne(), update()
   - JSON.parse of user input then passed to MongoDB operations
   - URL query params parsed as JSON and used in DB queries

2. JavaScript Expression Injection:
   - $where operator with user-controlled JavaScript expressions
   - $expr with user input in aggregation pipelines
   - db.eval() or db.runCommand() with user input

3. Unsanitized Query Building:
   - Template literals / string concatenation building MongoDB queries with user input
   - Object spread {...req.body} passed to Mongoose queries
   - Missing sanitization of $ keys in user-supplied objects

For each finding, identify:
1. Where user input enters the NoSQL query
2. Whether $ operators can be injected
3. The affected collection and operation
4. File and line number

Code context:
{code}
```

## Validation Prompt

```
A potential NoSQL injection was reported at {file}:{line}.

Reported snippet:
{snippet}

Evaluate whether this is a true positive:
1. Is the input truly user-controlled and reaching the NoSQL query?
2. Are $ operators stripped/sanitized before the query (mongo-sanitize, express-mongo-sanitize)?
3. Does the query use parameterized/typed inputs (Mongoose schema enforcement, type checking)?
4. Is the $where/$expr using only server-generated expressions?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

Common false positives:
- Mongoose models with strict schemas that reject extra fields including $ operators
- Use of mongo-sanitize or similar middleware that strips $ and . from keys
- $ operators used with server-generated values (not user input)
- Query parameters that are type-coerced before reaching MongoDB (parseInt, Boolean conversion)
- Aggregation pipelines with hardcoded $match stages
