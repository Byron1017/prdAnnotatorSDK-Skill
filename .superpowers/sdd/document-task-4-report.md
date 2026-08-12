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
