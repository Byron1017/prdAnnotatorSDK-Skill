# PRD Annotator workflows

## Contents

1. Intent and authorization
2. Universal annotation synchronization
3. Document inventory and ambiguity
4. User-authorized document creation and update
5. Legacy migration
6. Snapshot-verified removal
7. Gates and troubleshooting

## 1. Intent and authorization

Infer installation, synchronization, PRD, upgrade, and removal intent from natural language. Require no magic phrase.

Treat these as separate authorizations:

- Install or enable PRD Annotator in named prototype pages.
- Upgrade an existing SDK.
- Synchronize annotations into project JSON and regenerate views.
- Edit or explicitly delete annotations in the browser and synchronize that annotation state.
- Create or edit a page PRD or total PRD.
- Create or edit a Field specification.
- Create or edit an API document.
- Create or edit another related document.
- Remove the display layer.

Treat annotation synchronization alone as authorization to write annotation JSON and generated View data only. A browser tombstone authorizes removal of only its matching active annotation from the same page JSON. Annotation editing or deletion does not authorize a PRD or related-document edit; document changes require separate user intent. Installation, annotation creation, annotation synchronization, route refresh and View refresh do not authorize document writes. Never create or edit a document because a sync prompt was pasted.

## 2. Universal annotation synchronization

Prefer a current direct snapshot when page inspection is available. Otherwise use the browser's five-step fallback:

1. Click `复制同步提示词` in the Drawer.
2. Return to the AI Agent that can write the project.
3. Paste and send the complete prompt.
4. Wait for the Agent to report every file it wrote.
5. Refresh the prototype after view regeneration.

State that copying is not synchronization. The complete annotation payload is embedded so an Agent without browser tooling can persist it.

Extract the exact delimited JSON payload to a temporary file. Validate identity and paths, merge monotonically with `merge-annotations.mjs`, regenerate with `refresh-project.mjs`, and run `check-project.mjs`. Synchronization persists tombstones and may reduce only the active IDs matched by explicit same-page tombstones. Preserve all other permanent-only IDs and stale targets. Never interpret omission, an empty snapshot, or a missing DOM target as deletion intent.

If browser storage is memory-only, make copying and sending urgent before the page closes. If `file://` blocks a sibling script, use an ordinary static HTTP server only to view the prototype; add no save endpoint.

## 3. Document inventory and ambiguity

Refresh the whole-project inventory without moving source documents. Retain every plausible page PRD, total PRD, Field specification, API document, rule, requirement, other, and unclassified asset. Preserve explicit manual mappings and display groups. Mark missing or unpreviewable assets instead of dropping them.

Treat classification as evidence, never authority. Do not choose or merge ambiguous PRDs. When several page PRDs, total PRDs, or roots are plausible, list titles, project-relative paths, kinds, and evidence and ask the user to select.

## 4. User-authorized document creation and update

Accept any clear natural-language request for document work; require no formal phrase. The requested output may be a page PRD, total PRD, Field specification, API document, or related document.

For all authorized document work, read `document-writing.md` and `markdown-style.md`. An authorized page PRD uses exactly one matching type-specific reference: `page-prd.md`. An authorized total PRD uses exactly one matching type-specific reference: `total-prd.md`. An authorized Field specification uses exactly one matching type-specific reference: `field-spec.md`. An authorized API document uses exactly one matching type-specific reference: `api-document.md`. An authorized other related document uses the generic `document-writing.md` and `markdown-style.md` references only; never guess a specialized type.

1. Infer explicit create or update intent from the user's natural language.
2. Read the current logical-page JSON and every Manifest-linked document asset.
3. Discover same-kind document roots, filenames, formats, headings, tables, terminology, and the existing directory, naming, format, and section structure.
4. Use a user-selected target. Otherwise use a sole unambiguous same-kind structure; list candidates and ask when several are plausible.
5. Write only the requested page PRD, total PRD, Field specification, API document, or related document.
6. Preserve every other candidate, manual mapping, display group, and source document.
7. For clear page-only impact, update only the selected page PRD. For clear public-rule, cross-page-flow, or total-scope impact, also update the already identified total PRD and report a change summary; ask if that total target is ambiguous.
8. Refresh the Manifest inventory and generated Views, run `check-project.mjs`, and report changed files plus a content summary.

Create no document during install, annotation work, synchronization, route refresh, or View refresh. Reuse one unambiguous existing same-kind root and structure. For a new managed PRD only, use `doc/prd/` when no PRD root exists. If several roots or templates exist, ask before writing or passing `--document-root`.

Distinguish managed and external PRDs:

- Render a managed page PRD deterministically from page JSON and keep the managed total index complete; use `generate-prd.mjs --confirm-prd-write` only for these managed PRDs.
- Inventory and edit an external PRD only when selected; never force it into managed regeneration or overwrite it with a generated file.
- Write a selected Field specification, API document, or related document in the project's existing structure, then let discovery assign its Drawer display group without moving the source file.

Run `refresh-project.mjs` and `check-project.mjs` after PRD or linkage changes.

## 5. Legacy migration

Migrate legacy `doc/prd/manifest.json` only during an explicitly authorized install or upgrade and only with `--confirm-migration`. Use `--confirm-install` only when the schema-v2 destination has no manifest, SDK, data, or views. When the schema-v2 manifest file is absent, an existing SDK is an orphan recovery state: `--confirm-migration` and install authorization do not permit replacement, so stop before Release resolution unless the user separately authorized upgrade/recovery and `--confirm-upgrade`. Copy every annotation into canonical schema-v2 page JSON except an ID already represented by a canonical tombstone, inventory existing documents in place, verify each legacy annotation ID is active or tombstoned, and record migration metadata. Never move, edit, or delete legacy sources.

## 6. Snapshot-verified removal

Require explicit removal intent. Capture one current direct snapshot or complete pasted payload for every target page while its display layer is still mounted.

Call only `remove-project.mjs --confirm-remove`. Let it:

1. Validate target identities.
2. Merge every current snapshot monotonically.
3. Prove permanent JSON contains every live annotation and tombstone, and that an original active ID is absent only when both live and permanent data contain its tombstone.
4. Regenerate views and pass the enabled-page gate.
5. Remove only the selected HTML integration.
6. Set `page.display.enabled` to `false`.
7. Pass the post-removal gate.

Removal persists existing explicit tombstones and never invents tombstones from an omitted annotation. It does not authorize PRD changes; those still require separate user intent. Never manually delete an SDK script, call a data cleanup routine, or clear browser storage. Keep `.prd-annotator/`, SDK bytes, manifest, annotations, tombstones, views, documents, PRDs, and cache.

## 7. Gates and troubleshooting

- Run `check-project.mjs` after annotation, view, PRD, installation, migration, or removal changes.
- Stop installation cleanly if GitHub Release resolution or checksum verification fails; leave no broken HTML reference.
- Regenerate views when the browser reports missing or stale view data.
- Preserve a corrupt manifest and report validation failure; never reconstruct over it by guessing.
- Keep unpreviewable PDF/DOCX entries in the inventory and supply extracted text through an explicit preview map when available.
- Report changed files, remaining ambiguity, SDK version, and gate result. Never report success before the gate passes.
