# Total PRD fallback

Use this fallback only for separately authorized total-PRD work with no unambiguous project template or structure.

## Recommended sections

1. Product objective, overall scope, and explicit non-goals.
2. A complete page index covering every intended Manifest page, using valid relative links.
3. Roles, responsibilities, and public permission rules.
4. Main cross-page flow, branch flow, and terminal outcomes.
5. Shared business rules, state vocabulary, terminology, and constraints.
6. Indexes for page PRDs, field specifications, API documents, and other selected requirement assets.
7. Dependencies, risks, decisions, and open questions.
8. A concise change summary when the current request changes public rules or total scope.

## Update boundary

A page-only annotation does not authorize a total PRD update. Update an already identified total PRD only when the user authorized document work and the change clearly affects a public rule, cross-page flow, or total scope. Stop and ask when several total PRD candidates are plausible.

## Quality gate

- Keep the page index complete and free of broken or absolute local links.
- Do not duplicate full page specifications; summarize and link.
- Give every unresolved cross-page dependency an owner when evidence identifies one; otherwise mark the owner as `待确认`.
- Preserve all unselected total PRD candidates.
