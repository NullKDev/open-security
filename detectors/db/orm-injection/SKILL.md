---
id: orm-injection
title: ORM Injection / Raw Query Misuse
stages: [llm-scan, validate]
severity: critical
description: Detects SQL/NoSQL injection through ORM raw query methods — Prisma $queryRaw, Drizzle sql.raw, Sequelize literal, TypeORM query builder, and other ORM escape hatches with user input.
classical_prepass: semgrep
classical_hint: p/sql-injection
---

# ORM Injection Detector

## Detection Prompt

```
Analyze ORM code for injection through raw query methods. Look for:

1. Prisma:
   - $queryRaw / $executeRaw with template literals containing user input
   - $queryRawUnsafe with concatenated user data
   - Prisma.sql raw template with req.params, req.body, req.query

2. Drizzle:
   - sql.raw() with user-controlled strings
   - sql`` template tagged with interpolated user input without parameterization

3. Sequelize:
   - sequelize.query() with string concatenation (no replacements/bind params)
   - Sequelize.literal() with user input
   - Model.findAll({ where: { [Op.literal]: userInput } })

4. TypeORM / Knex / MikroORM / Bookshelf:
   - createQueryBuilder().where(userInput) without parameterization
   - manager.query(userInput) raw execution
   - knex.raw(userInput) with string interpolation

Code context:
{code}
```

## Validation Prompt

```
ORM injection at {file}:{line}. Is user input reaching the raw query? Are parameterized queries used ($1, ?, Prisma.sql tagged template)? Is input validated before reaching the ORM?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Prisma.sql tagged templates with only static values (no user interpolation)
- Query builders with .where({ id: validatedId }) using object syntax (ORM parameterizes)
- Raw queries with hardcoded table/column names (not user-controlled)
- Migration files executing raw SQL (not runtime attack surface)
