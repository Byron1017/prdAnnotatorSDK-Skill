# Page PRD fallback

Use this fallback only when authorized page-PRD work has no unambiguous project template. Existing project structure always wins.

## Page-local scope

Describe one physical HTML page or one registered logical route. For a local adjustment, record current behavior, requested behavior, affected area, and explicitly unaffected behavior. Do not require product-wide metrics, pricing, roadmap, launch dates, or business claims without evidence.

## Recommended sections

1. Page purpose and in-scope/out-of-scope boundary.
2. Entry point, route pattern, roles, and permission visibility.
3. Page regions, information hierarchy, and primary actions.
4. Normal, branch, reverse, and error flows with observable outcomes.
5. Loading, empty, error, success, disabled, and permission states when applicable.
6. Page business rules and state transitions.
7. Traceability from synchronized page annotations to the affected sections.
8. Relative links to selected field specifications and API documents.
9. Dependencies, risks, decisions, and open questions with owners when known.

## Quality gate

- Keep every rule within this page unless a documented cross-page dependency is required.
- Do not convert implementation ideas into product facts.
- Do not copy retired annotation fields into the PRD merely because historical JSON contains them.
- Keep fields and APIs in their dedicated documents when those documents exist; summarize and link instead of duplicating them.
