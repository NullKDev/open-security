# ADR-0005: Zod Validation at All API Boundaries

**Status**: Accepted (2026-05-02)

## Context

API routes receive JSON from the client. Without validation, malformed requests can cause runtime errors deep in the pipeline. We evaluated Zod against manual validation, Joi, and Yup.

## Decision

**Use Zod for all API request/response validation.** Every API route parses incoming data with a Zod schema before processing. Schemas are co-located in `lib/api/schemas/`.

## Consequences

### Positive
- **Type inference**: `z.infer<typeof Schema>` gives TypeScript types from the schema — single source of truth
- **Runtime safety**: Invalid requests are rejected at the boundary with clear error messages
- **Self-documenting**: Zod schemas serve as API documentation — you can see exactly what each endpoint accepts
- **Composable**: Schemas can be extended, merged, and reused across endpoints

### Negative
- **Bundle size**: Zod adds ~12 KB to the client bundle (acceptable for a desktop tool)
- **Schema maintenance**: Every API change requires a schema update — but this enforces discipline
- **Error message quality**: Default Zod error messages can be cryptic — we wrap them with `fail('INVALID_INPUT', message)`

## Alternatives considered

- **Manual validation**: More control, but repetitive, error-prone, and no type inference
- **Joi**: More features, but larger bundle, less TypeScript-friendly
- **Yup**: Lighter than Zod, but less mature ecosystem and poorer TypeScript integration
