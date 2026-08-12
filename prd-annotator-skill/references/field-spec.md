# Field specification fallback

Use this fallback only for authorized Field specification work with no unambiguous project structure. Group fields by business object, form, or page region.

## Scope

- A page Field specification describes one Manifest-resolved logical page and uses that page's terminology, states, and behavior. Store it as `scope: page` with that logical page ID; it appears in `页面字段规范`.
- A total Field specification is a project-wide index and shared field contract. Store it as `scope: global` with empty `pageIds`; it appears under `总字段规范` without copying every page document verbatim.
- Stop before selecting a file or root when scope is ambiguous. Report explicit scope, page IDs, source path, Drawer destination, and gate result after completion.

## Compact field table

Use this six-column table for simple fields:

| Field | Type | Required | Source | Constraints | Description |
|---|---|---|---|---|---|

Use inline code for field names and enum values. Keep each cell short. Move long validation, visibility, editability, empty-value, default-value, permission, and cross-field rules into a subsection below the table.

## Evidence and boundaries

- Distinguish business field names from transport fields and database columns.
- Do not guess database columns, lengths, types, enums, defaults, or source systems.
- Record only values proven by the prototype, selected documents, code, configuration, or explicit user decisions.
- Mark unknown values as `待确认`; do not complete a row with invented data.
- Link to the owning page PRD and API document with project-relative links.

## Quality gate

- One field per row and one meaning per field.
- No multiline prose or nested tables in a cell.
- Complex objects and conditional groups receive their own subsection.
- Terms, required markers, enum spelling, and empty-value behavior remain consistent across all groups.
