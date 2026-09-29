---
id: broken-access-control
title: Broken Access Control — IDOR, Privilege Escalation, RBAC Bypass
stages: [llm-scan, validate]
severity: critical
description: Detects broken access control — insecure direct object references (IDOR), missing authorization checks on sensitive endpoints, privilege escalation via mass assignment, RBAC bypass through role manipulation, and horizontal/vertical privilege escalation.
classical_prepass: semgrep
---

# Broken Access Control Detector

## Detection Prompt

```
You are hunting for broken access control vulnerabilities. These are the #1 category in OWASP Top 10. The attack: authenticated users access data or actions that belong to OTHER users, or users escalate their privileges beyond what they should have.

STEP 1 — Find all route/endpoint handlers. Open:
  Express: routes/, controllers/, handlers/ — all files with router.get, router.post, app.get, app.post
  Next.js: app/api/*, pages/api/* — all route.ts and route.js files
  Django: views.py, urls.py, viewsets.py
  Spring: @GetMapping, @PostMapping, @RequestMapping classes
  FastAPI: @app.get, @app.post, @router.get, @router.post decorated functions

STEP 2 — For each endpoint that returns or modifies user data, check authorization:

=== ATTACK 1: Insecure Direct Object Reference (IDOR) ===

An endpoint takes a user-supplied ID (order ID, user ID, invoice ID) and returns data for that ID WITHOUT verifying the requesting user owns it.

VULNERABLE pattern:
  GET /api/orders/:orderId
  handler: const order = await db.query("SELECT * FROM orders WHERE id = ?", [req.params.orderId])
  return res.json(order)
  MISSING: check that order.userId === req.user.id

VULNERABLE pattern (Python/Django):
  def get_invoice(request, invoice_id):
      invoice = Invoice.objects.get(id=invoice_id)
      return JsonResponse(invoice.data)
  MISSING: if invoice.user != request.user: raise PermissionDenied

SAFE patterns:
  const order = await db.query("SELECT * FROM orders WHERE id = ? AND user_id = ?", [orderId, req.user.id])
  Invoice.objects.get(id=invoice_id, user=request.user)
  order = Order.query.filter_by(id=order_id, user_id=current_user.id).first_or_404()

FLAG: any endpoint that:
  - Takes an ID from req.params, req.query, req.body, path variable
  - Fetches a record by that ID from DB
  - Does NOT include the authenticated user's ID in the WHERE clause

=== ATTACK 2: Missing Authorization on Admin/Privileged Endpoints ===

Admin endpoints that only check "is authenticated" but not "is admin":

VULNERABLE:
  router.get('/api/admin/users', authenticate, getAllUsers)  ← authenticate checks session, but not role
  The authenticate middleware verifies the JWT but doesn't check req.user.role === 'admin'

VULNERABLE (Next.js):
  export async function GET(req) {
    const session = await getSession(req)
    if (!session) return unauthorized()
    const allUsers = await db.users.findMany()  ← returns ALL users, no role check
    return NextResponse.json(allUsers)
  }

FLAG: admin-like endpoints (/admin/*, /api/admin/*, /manage/*, /internal/*) that:
  - Only check authentication (session/JWT exists) but not authorization (role)
  - Return all-users data, user PII, or perform privileged operations

=== ATTACK 3: Privilege Escalation via Mass Assignment ===

User updates their own profile but the update query allows changing privileged fields:

VULNERABLE:
  const user = await User.findByPk(req.user.id)
  await user.update(req.body)  ← updates ALL fields from request body, including: role, isAdmin, subscription_tier

VULNERABLE (Python):
  user = User.objects.get(id=request.user.id)
  user.__dict__.update(request.data)  ← mass update

SAFE: explicit allowlist of updatable fields:
  await user.update({ name: req.body.name, bio: req.body.bio })  ← only non-privileged fields
  User.objects.filter(id=request.user.id).update(name=request.data['name'])

FLAG: any user self-update endpoint where the update query uses the full request body without field filtering.

=== ATTACK 4: Horizontal Privilege Escalation ===

User A accesses User B's resources by simply changing the target ID.

Look for URL patterns: /api/users/:userId/*, /api/profile/:userId, /api/messages/:userId
Check if the handler verifies that req.params.userId === req.user.id (or that req.user has permission to access that userId)

VULNERABLE:
  router.get('/users/:userId/messages', auth, async (req, res) => {
    const messages = await Messages.findAll({ where: { userId: req.params.userId } })
    return res.json(messages)
  })
  MISSING: if (req.params.userId !== req.user.id) return forbidden()

=== ATTACK 5: RBAC Bypass via Client-Controlled Role ===

VULNERABLE: role read from JWT payload that the CLIENT controls:
  const role = req.body.role  ← user sends their own role
  const role = decodedToken.role  ← if token is self-signed or role not verified server-side

VULNERABLE: role stored in a cookie or local storage that is not signed:
  const isAdmin = req.cookies.isAdmin  ← cookie not signed
  const role = localStorage.getItem('role')  ← client-side (no server verification)

SAFE: role read from server-side session (database-backed):
  const user = await User.findByPk(req.session.userId)
  if (user.role !== 'admin') return forbidden()

=== ATTACK 6: Function-Level Authorization Missing ===

Certain HTTP methods are unprotected on the same route:
  GET /api/user/:id — protected ✓
  DELETE /api/user/:id — NOT protected (missing auth middleware for DELETE method)
  PUT /api/admin/settings — accessible without admin role check

Check: does each HTTP method (GET, POST, PUT, DELETE, PATCH) on sensitive routes independently apply auth middleware?
```

## Validation Prompt

```
Broken access control reported at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. What resource is being accessed or modified? (whose data?)
2. Is there a check that the authenticated user is AUTHORIZED to access this specific resource (not just authenticated)?
3. For IDOR: does the database query include a WHERE user_id = current_user.id condition?
4. For admin endpoints: is the user's ROLE checked, or just their authentication status?
5. For updates: does the update query use the full request body (mass assignment), or an explicit field allowlist?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Admin reading ANY user's data by admin choice (not user-controlled ID) — admin-level access is expected for admin roles; verify the admin role IS checked
- System-to-system API calls (internal microservices) where all callers are trusted services with service account credentials — no user-level IDOR possible
- Read-only public endpoints (public product catalog, public blog posts) where data is meant to be universally accessible
- UUID-based IDs instead of sequential integers — significantly harder to enumerate, reduces exploitability (but still flag if no ownership check)
- Permission checks performed by a dedicated middleware that runs before the handler — verify the middleware is actually applied to this route
- GraphQL resolvers using DataLoader with per-user context that only fetches owned records — check the DataLoader's where clause
