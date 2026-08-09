# PRD Annotator workflows

## Contents

1. Install the display layer
2. Read and merge current annotations
3. Update page and total PRDs
4. Hydrate permanent data
5. Continue frontend development
6. Remove the display layer
7. Restore the display layer

## 1. Install the display layer

Copy or reference the built SDK and add one script tag to the prototype:

```html
<script src="/code/prd-annotator/prd-annotator.js"
        data-page-id="equipment-ops"
        data-project-id="device-demo"></script>
```

`data-page-id` and `data-project-id` are optional. Without `data-page-id`, the SDK derives a stable short ASCII ID from `location.pathname`. Prefer explicit IDs when a manifest already defines the page.

The browser layer shows only `标注模式` and `PRD 标注`. Do not add transport or AI chat controls.

## 2. Read and merge current annotations

1. Read `doc/prd/manifest.json`.
2. Resolve the current page by explicit page ID or normalized route.
3. Read its permanent JSON, page PRD, and `doc/prd/PRD.md`.
4. When the SDK is mounted, inspect `window.PRDAnnotator.getSnapshot()` directly through the available browser tooling.
5. Save that snapshot to a temporary JSON file controlled by the Agent.
6. Run:

```powershell
node prd-annotator-skill/scripts/merge-annotations.mjs `
  --project-root <project-root> `
  --snapshot <snapshot-json>
```

7. Re-read the merged permanent JSON before editing PRDs.

Do not ask the human to copy, download, export, or upload annotation data. Browser JavaScript cannot write arbitrary project files; the participating Agent performs the file merge.

## 3. Update page and total PRDs

For each clear open annotation:

1. Determine the affected page PRD sections.
2. Update the page PRD with requirements, constraints, and acceptance criteria supported by the annotation.
3. Set `prd.summary` to the concise applied change.
4. Set `prd.linkedSections` to the exact page PRD section names.
5. Set status to `applied` after the PRD contains the requirement.

If the annotation clearly changes a public rule, shared component contract, cross-page flow, or total product scope:

1. Set `prd.impactScope` to `global`.
2. Update the page PRD.
3. Update `doc/prd/PRD.md` in the same change.
4. Report the page and total PRD changes in the completion summary.

If product meaning is genuinely ambiguous, set status to `needs-clarification` and ask one focused question. Do not ask for confirmation when the impact is clear.

Run the gate after edits:

```powershell
node prd-annotator-skill/scripts/check-prd.mjs --project-root <project-root>
```

## 4. Hydrate permanent data

When the browser cache is absent or another environment opens the prototype:

1. Read the page annotation JSON and page PRD Markdown.
2. Build the documented hydrate input.
3. Call:

```js
window.PRDAnnotator.hydrate({
  document: permanentAnnotationDocument,
  pagePrdMarkdown: permanentPagePrd
});
```

Hydration is additive. An empty incoming document cannot remove browser-only annotations.

## 5. Continue frontend development

Before changing business UI:

1. Read the current page JSON, page PRD, and total PRD.
2. Treat nodes under `[data-prd-annotator-ui]` as tooling, not product UI.
3. Preserve unresolved target descriptors when DOM structure changes.
4. Implement clear applied requirements from the PRD.
5. Re-run the PRD gate after changes that update annotations or PRDs.

The display layer may be absent. Permanent project files remain the source for continuing development.

## 6. Remove the display layer

Follow this sequence exactly:

1. Read `window.PRDAnnotator.getSnapshot()` while the layer still exists.
2. Run `merge-annotations.mjs`.
3. Compare snapshot annotation IDs with the permanent page JSON and confirm every snapshot ID is present.
4. Run `check-prd.mjs`.
5. Remove only the SDK script reference or integration hook from the prototype.
6. Confirm no `[data-prd-annotator-ui]` visual node remains.
7. Run `check-prd.mjs` again.

Do not alter `doc/prd/`, localStorage, or permanent annotation history during display-layer removal.

## 7. Restore the display layer

1. Restore the single SDK script reference.
2. Let the matching browser cache restore automatically when present.
3. Otherwise hydrate from the permanent page JSON and page PRD.
4. Confirm the Drawer shows the permanent annotations and complete page PRD.
5. Run the PRD gate if any file changes were required.
