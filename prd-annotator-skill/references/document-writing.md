# Document writing workflow

## Boundary

Use this workflow only after the user separately authorizes creating, organizing, generating, supplementing, or updating a document. Never create or edit a document from annotation synchronization alone. External borrowed document logic may enhance an authorized page PRD, total PRD, Field specification, or API document only through its matching type-specific reference. External borrowed document logic influences authorized document writing only; it never participates in annotation fields, storage, merge, deletion, identity, fingerprinting, or gates.

Synchronized page annotations are read-only evidence for an authorized document task. Document work must not modify annotation JSON. Refresh may update generated Manifest document inventory, Views, and route or display artifacts as applicable, but authorized document work must not edit source documents except the authorized target and must never modify annotation JSON.

## Select the target

1. Use the exact document named by the user.
2. Otherwise use a sole unambiguous same-kind target and existing structure.
3. When several documents, roots, or templates are plausible, list title, project-relative path, kind, and evidence, then ask.
4. Never choose, merge, move, delete, or demote unselected candidates.
5. Use a built-in fallback reference only when the project has no unambiguous same-kind convention.

## Establish facts

Read evidence in this order:

1. Current explicit user decisions.
2. Confirmed prototype page, logical route, and observable behavior.
3. Permanently synchronized logical-page annotations.
4. The selected existing document and its linked documents.
5. Verifiable project code and configuration.

Do not treat unsynchronized browser content as a permanent project fact. Do not invent business, backend, API, field, security, legal, owner, metric, date, or release facts. Mark an unresolved fact as an open question. Stop and ask when a conflict materially changes scope or behavior.

## Write and validate

1. Identify document audience, purpose, kind, target, and scope.
2. Preserve the selected project's headings, terminology, filenames, links, and concise table style.
3. Separate facts, assumptions, decisions, and open questions.
4. Keep product requirements implementation-neutral; describe observable behavior, rules, ownership boundaries, states, and contracts.
5. Check gaps, contradictions, redundancy, dangling dependencies, overreach, and unowned cross-page behavior.
6. Write only the authorized document type.
7. For page-only impact, update only the selected page PRD. Update an already identified total PRD only for an authorized public-rule, cross-page-flow, or total-scope change. Ask if the total target is ambiguous.
8. Validate Markdown using `markdown-style.md` and, for a page PRD, total PRD, Field specification, or API document, its one matching type-specific reference. For another related document, use only this generic workflow and `markdown-style.md`; never guess a specialized type.
9. Run `refresh-project.mjs`, then `check-project.mjs`.
10. Report changed files, content summary, total-PRD linkage, and remaining open questions.
