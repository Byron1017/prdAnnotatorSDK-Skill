# Product API document fallback

Use this fallback only for authorized API-document work with no unambiguous project structure. This is a product API requirement document for capability, business behavior, and integration boundaries. Do not present this fallback as OpenAPI or as an engineering implementation specification.

## Recommended sections

1. Purpose, scope, caller, provider, base path, version, and authentication when known.
2. A compact capability catalog:

| Method | Path | Purpose |
|---|---|---|

3. One subsection per interface containing use cases and business preconditions.
4. Request parameters with location, required state, type, business meaning, and validation.
5. Response fields with type, presence rule, and business meaning.
6. Fenced JSON request and response examples when verified examples exist.
7. Business failures, user-visible outcomes, error codes, retry behavior, and recovery when known.
8. Permission, sensitive-data, audit, rate-limit, idempotency, webhook, and dependency rules when applicable.
9. Explicit non-goals, risks, decisions, and open questions.

## Evidence and boundaries

- Do not invent paths, authentication, status codes, fields, or error structures.
- Separate product API intent from low-level algorithms, database layout, queue choice, or framework design.
- Use a selected OpenAPI source as engineering truth when it exists; summarize and link rather than silently rewriting it.
- Generate or edit OpenAPI only when the user explicitly requests OpenAPI work.

## Quality gate

- Every catalog row links conceptually to one detailed interface subsection.
- Methods and paths use inline code and stay consistent across catalog, prose, and examples.
- Request/response tables remain concise; nested schemas use separate subsections or fenced examples.
- Every documented failure states the business meaning and expected consumer behavior when evidence supports it.
