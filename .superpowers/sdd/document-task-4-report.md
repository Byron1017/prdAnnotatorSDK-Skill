# Document Task 4 Report — Focused page and total PRD references

## Status

Complete. The Skill now provides separate page-local and cross-page/total PRD fallbacks for their matching, separately authorized document routes. Existing unambiguous project templates and structures continue to take precedence.

## RED

Command:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "separate page and total PRD"
```

Result: expected failure before creating either reference: 1 test failed and 31 were skipped. The failure was `ENOENT` for the absent `prd-annotator-skill/references/page-prd.md`, confirming the contract exercised the missing fallback reference.

## GREEN

Commands:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "separate page and total PRD"
npx vitest run tests/unit/skill-scripts.test.js
```

Results: the focused contract passed 1 test with 31 skipped. The full Skill contract passed all 32 tests.

## Files

- `prd-annotator-skill/references/page-prd.md` — page-local fallback scope, recommended sections, and quality gate.
- `prd-annotator-skill/references/total-prd.md` — complete page index, cross-page/total scope, update boundary, and quality gate.
- `tests/unit/skill-scripts.test.js` — mechanical contract separating the page and total fallbacks.
- `.superpowers/sdd/document-task-4-report.md` — RED/GREEN evidence, files, commit, and self-review.

## Commit

`docs: define page and total PRD fallbacks`

## Self-review and concerns

- Both references are conditional fallbacks: an existing unambiguous project template or structure always wins.
- The page fallback is limited to one physical HTML page or one registered logical route. It does not require product-wide metrics or other unsupported business claims.
- The total fallback covers the complete page index, public/shared rules, cross-page flows, and total scope without duplicating full page specifications.
- A page-only annotation does not authorize a total PRD update. Total PRD changes still require separately authorized document work plus clear public-rule, cross-page-flow, or total-scope impact.
- Permanently synchronized annotations remain read-only evidence; no annotation JSON, annotation fields, storage, merge, fingerprinting, API, or runtime behavior changed.
- No Field specification or API document reference was introduced; those remain Document Task 5 scope.
- The supplied `待确认` marker is valid UTF-8 without a BOM. No encoding corruption was detected.
- No unresolved implementation concerns.

## Fix wave — complete fallback and UTF-8 contract coverage

### Review finding

The original focused test protected only six substrings. It did not mechanically guard most page/total authorization, scope, content, update, link, preservation, or encoding contracts.

### RED

Command:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "separate page and total PRD"
```

Result: expected failure after adding the strict-reader contract and before implementing its helper: 1 test failed and 31 were skipped. The assertion reported `expected 'undefined' to be 'function'` for the absent `readStrictUtf8` helper.

### GREEN

Commands:

```powershell
npx vitest run tests/unit/skill-scripts.test.js -t "separate page and total PRD"
npx vitest run tests/unit/skill-scripts.test.js
```

Results: the focused contract passed 1 test with 31 skipped. The full Skill contract passed all 32 tests.

### Test and boundary coverage

- The focused test now protects D3's separate document-authorization and matching page/total routing before validating each fallback's no-unambiguous-project-template/convention gate.
- Page coverage includes one physical HTML page or registered logical route; affected and explicitly unaffected behavior; entry/route/roles/regions/actions; all required flows and applicable states; page rules/transitions; synchronized-annotation traceability; relative Field/API links; dependencies/risks/open questions; unsupported product-wide facts; and retired-field exclusion.
- Total coverage includes every intended Manifest page; public roles/rules; cross-page flows and outcomes; shared rules/vocabulary; selected asset indexes; dependencies and change summary; separately authorized, already identified, clearly impacted total updates; ambiguity stop; page-only non-authorization; local-link safety; and preservation of unselected candidates.
- Both references are read as bytes and decoded with `new TextDecoder("utf-8", { fatal: true })`. The test rejects a UTF-8 BOM, U+FEFF, U+FFFD, selected common mojibake fragments, and requires exactly one `待确认` marker in `total-prd.md`.
- Reference contents, annotation JSON, fields, runtime, route, storage, merge, identity, fingerprint, and API behavior were not changed.
