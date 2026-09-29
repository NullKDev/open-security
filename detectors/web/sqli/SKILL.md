---
id: sqli
title: SQL Injection
stages:
  - llm-scan
  - validate
severity: critical
description: Detects SQL injection vulnerabilities where user-controlled input flows into SQL queries via string concatenation, format strings, or ORM raw() calls without parameterization.
classical_prepass: semgrep
classical_hint: p/sql-injection
---

# SQL Injection Detector

## Detection Prompt

```
You are hunting for SQL Injection. Trace every user-controlled value to every SQL execution point. Do NOT assume something is safe because it "looks parameterized" — verify actual parameterization.

STEP 1 — Open database access files first:
  Look for: models/, repositories/, dao/, db/, queries/, services/ directories
  Key file patterns: *.repository.ts, *.dao.java, models.py, db.go, *.repo.ts

STEP 2 — Identify all SQL execution functions in those files:

JavaScript/TypeScript:
  db.query("..."), db.execute("..."), connection.query("..."), pool.query("...")
  knex.raw("..."), sequelize.query("..."), typeorm.query("..."), prisma.$queryRaw("...")
  sqlite3.run("..."), pg.query("..."), mysql.query("...")

Python:
  cursor.execute("..."), cursor.executemany("..."), engine.execute("...")
  db.session.execute("..."), connection.execute("...")
  Model.objects.raw("..."), Model.objects.extra(where=["..."])

Java:
  statement.executeQuery("..."), statement.execute("..."), statement.executeUpdate("...")
  jdbcTemplate.query("..."), jdbcTemplate.execute("...")
  entityManager.createNativeQuery("..."), session.createSQLQuery("...")

PHP:
  mysqli_query($conn, "..."), $pdo->query("..."), $pdo->exec("...")

Go:
  db.Query("..."), db.QueryRow("..."), db.Exec("...")

STEP 3 — For EVERY SQL call, inspect the query string for concatenation/interpolation:

VULNERABLE patterns — flag immediately:
  JavaScript: `SELECT * FROM users WHERE id = '${req.query.id}'`
  JavaScript: "SELECT * FROM users WHERE name = '" + req.body.name + "'"
  Python: f"SELECT * FROM users WHERE id = '{user_id}'"
  Python: "SELECT * FROM users WHERE name = '%s'" % name  ← VULNERABLE (% formatting)
  PHP: "SELECT * FROM users WHERE id = " . $_GET['id']
  Java: "SELECT * FROM users WHERE id = " + userId  ← VULNERABLE
  Go: fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", userID)

SAFE patterns — NOT vulnerable:
  JavaScript: db.query("SELECT * FROM users WHERE id = $1", [userId])
  JavaScript: db.query("SELECT * FROM users WHERE id = ?", [userId])
  Python: cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))  ← safe (tuple param)
  PHP: $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?"); $stmt->execute([$id]);
  Java: PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?"); ps.setInt(1, userId);
  Go: db.Query("SELECT * FROM users WHERE id = $1", userID)

STEP 4 — Check ORM "escape hatch" methods which allow raw SQL:
  Sequelize: Model.findAll({ where: sequelize.literal(`id = '${input}'`) })  ← VULNERABLE
  TypeORM: .where(`user.id = '${id}'`)  ← VULNERABLE
  Prisma: prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`  ← SAFE (tagged template)
  Prisma: prisma.$queryRawUnsafe(`SELECT * FROM ${table}`)  ← VULNERABLE
  Django: Model.objects.raw(f"SELECT * FROM users WHERE id = '{id}'")  ← VULNERABLE
  Django: Model.objects.filter(id=id)  ← SAFE (parameterized by ORM)

STEP 5 — Check dynamic ORDER BY, table name, or column name injection:
  "ORDER BY " + req.query.sort  ← cannot be parameterized, needs allowlist
  "SELECT * FROM " + tableName  ← needs strict allowlist validation
  Flag any dynamic SQL fragment that uses column/table names from user input without an explicit allowlist check
```

## Validation Prompt

```
A potential SQL injection was reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL four questions:
1. Is the string in the SQL query built with concatenation, format strings, or f-strings containing user input — or does it use proper parameterized placeholders (?, $1, :name)?
2. Trace the variable back: does it originate from user input (HTTP request, env var, file) or is it hardcoded/internal?
3. If an ORM is used, is it a "raw" or "unsafe" ORM call, or a standard ORM method that auto-parameterizes?
4. For ORDER BY / table / column name injection: is there an explicit allowlist check before the value is interpolated?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- `cursor.execute("SELECT ... WHERE id = %s", (value,))` in Python is SAFE — the tuple is parameterized (not format-string injection)
- Django ORM `.filter()`, `.get()`, `.exclude()` calls are always safe — they parameterize automatically
- TypeORM/Sequelize `.findOne({ where: { id: userId } })` is safe — object-style where clauses are parameterized
- Prisma tagged template literals (`` prisma.$queryRaw`SELECT ... WHERE id = ${id}` ``) are safe — Prisma escapes interpolations
- SQL in test fixtures with hardcoded strings (no variables) are not injectable
- Queries filtering only on server-controlled values (e.g., an internal user ID from a verified JWT payload that was already validated) have no injection vector
- `LIKE '%term%'` where `term` comes from validated/escaped input is low risk (still flag, but lower confidence)
