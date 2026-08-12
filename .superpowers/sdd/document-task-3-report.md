# Document Task 3 Report — Consent-gated document workflow

## Status

Complete. The Skill control plane now loads document-writing guidance only after separate document authorization and routes authorized work to the core workflow, Markdown style, and exactly one applicable document-type reference.

## RED

Command:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "loads document writing references"
```

Result: expected failure before implementation: 1 test failed and 29 were skipped. The failure was `ENOENT` for the absent `prd-annotator-skill/references/document-writing.md`, confirming the new mechanical contract exercised the missing reference boundary.

## GREEN

Commands:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "loads document writing references"
npx vitest run tests/unit/skill-scripts.test.js
```

Results: the focused contract passed 1 test with 29 skipped. The full Skill contract passed all 30 tests.

## Files

- `prd-annotator-skill/references/document-writing.md` — authorization boundary, target selection, evidence order, writing scope, refresh/check gates, and reporting contract.
- `prd-annotator-skill/references/markdown-style.md` — Markdown structure, tables, code, links, and readability gates.
- `prd-annotator-skill/SKILL.md` — consent-gated core/style routing, four conditional type routes, and explicit non-document exclusions.
- `prd-annotator-skill/references/prd-workflow.md` — authorized document work now selects core + style + exactly one applicable type reference.
- `tests/unit/skill-scripts.test.js` — mechanical document boundary and routing contract.
- `.superpowers/sdd/document-task-3-report.md` — RED/GREEN evidence, scope, and self-review.

## Commit

`docs: add consent-gated document workflow`

## Self-review and concerns

- Installation, annotation creation, annotation synchronization, annotation edit/delete, route refresh, View refresh, and display-layer removal explicitly neither load/apply the writing references nor create/edit documents.
- Synchronized annotations remain read-only evidence; authorized document work must not modify annotation JSON.
- Exact targets and sole unambiguous same-kind targets are permitted; plausible alternatives remain unselected and are listed for user choice. No candidate may be merged, moved, deleted, or demoted implicitly.
- Managed and external PRD distinctions remain unchanged. External PRDs are edited only when selected and are never forced through managed regeneration.
- Refresh and `check-project.mjs` gates remain required after authorized document changes.
- Type routing is conditional: document work loads the core workflow and style reference plus exactly one applicable type reference, never all four.
- Brief consistency adjustment: the corrupted placeholder text in the supplied Markdown style block was normalized to the intended UTF-8 `待确认`. No other supplied contract text was changed except the explicitly requested routing/exclusion statements.
- The four type-specific reference files are intentionally named but not created in this task; they belong to Document Tasks 4 and 5.

## Fix wave — specialized and generic routing boundary

### Review findings

The original controller wording required exactly one type-specific reference for every authorized document kind. That overreached for authorized other related documents, which have no matching specialized reference. The refresh wording also implied generated Views were the only refresh artifacts, obscuring generated Manifest inventory and route/display updates.

### RED

Command:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "routes specialized and generic document work"
```

Result: expected failure: 1 test failed and 30 were skipped. The first failure showed that the exclusion sentence combined annotation edit/delete rather than explicitly naming annotation editing and annotation deletion. The new contract also guards specialized one-to-one mappings, generic-only related-document routing, borrowed-logic isolation, refresh scope, and non-document sections.

### GREEN

Commands:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "routes specialized and generic document work"
npx vitest run tests/unit/skill-scripts.test.js
```

Results: the focused review contract passed 1 test with 30 skipped. The full Skill contract passed all 31 tests.

### Boundary self-review

- Page PRD, total PRD, Field specification, and API document each load exactly one matching type-specific reference after separate document authorization.
- An authorized other related document loads only `document-writing.md` and `markdown-style.md`; it never guesses or loads a specialized type.
- Installation, annotation creation, annotation synchronization, annotation editing, annotation deletion, route refresh, View refresh, and display-layer removal explicitly do not load/apply writing references and do not create/edit source documents.
- External borrowed document logic can enhance only the four specialized document kinds through their matching references. It never participates in annotation fields, storage, merge, deletion, identity, fingerprinting, or gates.
- Refresh may update generated Manifest document inventory, Views, and route/display artifacts as applicable. It may not edit source documents except the authorized target and must never modify annotation JSON.
- Target ambiguity, unselected candidates, managed/external distinctions, and refresh/check gates remain unchanged. No D4/D5 type file or annotation/runtime file was created or modified.
