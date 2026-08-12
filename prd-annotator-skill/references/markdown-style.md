# Markdown document style

## Structure

- Start with one descriptive `#` title and increase heading depth one level at a time.
- Omit empty optional sections. Do not emit empty placeholder tables or template instructions.
- Keep terminology and capitalization consistent with selected project documents.
- Separate confirmed facts, assumptions, decisions, risks, and open questions.

## Tables

- Use one table for one repeated mapping and keep tables to three to six columns when practical.
- Keep cells concise. Move paragraphs, multi-rule constraints, and long examples below the table.
- Use inline code for field names, enum values, HTTP methods, API paths, file paths, and route patterns.
- Escape literal pipes as `\|`. Do not place multiline prose in a table cell.
- Prefer bullets or per-item subsections when a table would be wider than the Drawer.

## Code and links

- Use fenced blocks with a language label for JSON, YAML, requests, responses, and longer examples.
- Use project-relative Markdown links for internal documents. Never emit `file://` links or paths outside the project root.
- Use descriptive link text rather than a raw local absolute path.
- Do not embed raw HTML for layout.

## Readability gate

- Every heading must contain useful content before the next heading.
- Tables must have a delimiter row and the same number of columns on every row.
- Long requirements must be atomic and testable instead of joined by unrelated `and` clauses.
- Unknown facts must say `待确认` or appear under an open-question section; never fabricate a value to complete a table.
