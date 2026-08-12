# Document Task 2 Report — GFM Markdown Tables

## Status

Complete. Markdown table detection, safe DOM rendering, Drawer integration, and shared presentation styles are implemented within the task boundary.

## RED

Command:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Result: expected failure before implementation: 2 test files failed; 3 tests failed and 43 passed (46 total). The failures showed no table wrapper/cells and no Drawer table.

## GREEN

Command:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Result: passed: 2 test files and all 46 tests.

## Files

- `prd-annotator/src/markdown-table.js` — GFM table parser and semantic DOM renderer.
- `prd-annotator/src/markdown.js` — detects tables before other block types and ends a paragraph before a valid table.
- `prd-annotator/src/ui/styles.js` — scroller, compact table, alignment, inline-code, and link styles.
- `tests/unit/markdown.test.js` — semantic structure, alignment, escaped/code pipes, and invalid-delimiter fallback coverage.
- `tests/unit/prd-drawer.test.js` — field-spec document-card integration coverage.

## Commit

`feat: render readable markdown tables`

## Self-review and concerns

- The parser only accepts a valid delimiter row with at least two columns; malformed delimiter rows remain readable Markdown text.
- Escaped pipes and pipes within backtick code spans stay in their original cells.
- Cells use the existing `appendInlineMarkdown` helper; no URL sanitization is duplicated or weakened.
- Rendering is DOM-only (`createElement` and `textContent` through the existing inline renderer); no `innerHTML` is introduced.
- Body rows with mismatched cell counts end the table instead of producing malformed DOM. This is intentional graceful fallback behavior.

## Fix wave — lossless row lexer

### Root cause

The original lexer stripped a trailing pipe before determining whether that pipe was structural or escaped. It also treated every backtick as an on/off toggle, which neither respected odd/even backslash runs before pipes nor recognized matched equal-length code-span delimiters. As a result, terminal escaped pipes lost content, multi-backtick spans could split, and unmatched backticks could suppress real separators.

### RED

Command:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Result: 2 test files ran; `tests/unit/markdown.test.js` had 4 expected failures and 39 passes, while `tests/unit/prd-drawer.test.js` had 8 passes (47 passed, 4 failed, 51 total). The failures covered terminal escaped pipes, backslash-run parity, matched multi-backtick spans, and unmatched backticks.

### GREEN

Commands:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
npx vitest run tests/unit
```

Results: focused suite passed 2 test files and 51 tests. Full unit suite passed 31 test files, 852 tests, with 2 pre-existing skips (854 total).

### Self-review and deferred triage

- `splitTableRow` now identifies matched equal-length backtick spans before classifying pipes, so unmatched delimiters remain ordinary cell text and cannot suppress structural separators.
- Backslash runs are handled by parity: odd runs escape a pipe and retain the literal pipe; even runs leave the pipe structural while retaining literal backslashes.
- Leading and trailing pipes are discarded only after classification proves they are structural. Exact-width rows are consumed; mismatched rows remain available to the outer paragraph parser exactly once.
- The renderer remains DOM-only and continues to delegate cell text to `appendInlineMarkdown`.
- Deferred Minor finding for final triage only: a zero-body-row table retains the header bottom border because the current cleanup selector targets a final body row. This fix wave intentionally does not change that style behavior.

## Fix wave 2 — protected code-span content

### Root cause

Although matched code-span ranges were precomputed, the row lexer checked for a backslash run before checking whether the current character belonged to a protected range. A backslash immediately before a pipe inside a matched code span therefore entered the outside-table parity path, mutating or splitting code content.

### RED

Command:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
```

Result: 2 test files ran; the new single- and multi-backtick cross-product test failed while 51 tests passed (51 passed, 1 failed, 52 total). The failing assertion had no body cells because the protected-span backslash run was classified as a table separator.

### GREEN

Commands:

```powershell
npx vitest run tests/unit/markdown.test.js tests/unit/prd-drawer.test.js
npx vitest run tests/unit
```

Results: focused suite passed 2 test files and 52 tests. Full unit suite passed 31 test files, 853 tests, with 2 pre-existing skips (855 total).

### Self-review and deferred triage

- Matched code-span ranges now take precedence over every lexer branch: their backticks, backslashes, and pipes are copied verbatim for `appendInlineMarkdown`.
- Backslash parity remains limited to content outside protected ranges; no DOM rendering or sanitization behavior changed.
- The zero-data-row border Minor remains intentionally deferred for final triage.
