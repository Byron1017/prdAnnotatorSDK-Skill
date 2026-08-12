# Field specification fallback

Use this fallback only for authorized Field specification work with no unambiguous project structure. Group fields by business object, form, or page region.

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
