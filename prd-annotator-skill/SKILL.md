---
name: prd-annotator
description: Use when maintaining human annotations and AI-authored PRDs for HTML prototypes, including installing or removing the annotation display layer, reading current-page annotations, updating a page PRD or total PRD, restoring saved annotations, validating PRD coverage, or continuing frontend work after the visual layer is gone.
---

# PRD Annotator

## Core principle

Treat the SDK display layer as temporary and `doc/prd/` data as permanent. Let the human annotate the prototype; perform file persistence, PRD synthesis, validation, hydration, and safe display-layer removal as the participating Agent.

Never require a fixed trigger phrase. Infer intent from requests to process current-page annotations, maintain PRDs, restore annotations, continue frontend work, or remove the annotation UI.

## Load references only when needed

- Read [references/data-schema.md](references/data-schema.md) before creating or validating manifest or annotation JSON.
- Read [references/prd-workflow.md](references/prd-workflow.md) before installing, hydrating, updating PRDs, continuing frontend development, or removing/restoring the display layer.

## Quick workflow

| Situation | Required action |
|---|---|
| Start work on a prototype page | Locate `doc/prd/manifest.json`; read page JSON, page PRD, and total PRD |
| Display layer exists | Read `window.PRDAnnotator.getSnapshot()` directly with browser tooling |
| Snapshot contains annotations | Run `scripts/merge-annotations.mjs` before editing PRDs |
| Clear page-only impact | Update the page PRD and annotation linkage |
| Clear public or cross-page impact | Update both the page PRD and total PRD |
| Product meaning is ambiguous | Ask one focused question and mark the annotation `needs-clarification` |
| PRD or annotation files changed | Run `scripts/check-prd.mjs` |
| Remove the visual layer | Merge, compare IDs, run the gate, remove only injection, run the gate again |

## Process current-page annotations

1. Locate the project root and `doc/prd/manifest.json`.
2. Resolve the current page semantically, by explicit page ID, or by normalized route.
3. Read the page annotation JSON, page PRD, and `doc/prd/PRD.md` before frontend or PRD edits.
4. Ignore every node under `[data-prd-annotator-ui]` during business UI analysis.
5. If the display layer exists, inspect `window.PRDAnnotator.getSnapshot()` directly. Do not ask the human to copy, download, export, or upload data.
6. Save the snapshot to an Agent-controlled temporary file and run:

```powershell
node prd-annotator-skill/scripts/merge-annotations.mjs `
  --project-root <project-root> `
  --snapshot <snapshot-json>
```

7. Re-read the merged page JSON. Preserve every annotation ID, including unresolved DOM targets.
8. Apply clear annotations to the page PRD. Record exact section names in `prd.linkedSections`, summarize the change in `prd.summary`, and set status to `applied` only after the requirement exists in the PRD.
9. If impact clearly reaches shared rules, public components, cross-page flows, or total scope, set `impactScope` to `global` and update the total PRD in the same change.
10. Ask one focused question only when product meaning cannot be determined safely.
11. Run:

```powershell
node prd-annotator-skill/scripts/check-prd.mjs --project-root <project-root>
```

12. Report page PRD changes, total PRD changes, statuses, and any remaining clarification.

## Continue frontend development

Read the current page JSON, page PRD, and total PRD before changing business UI, even when the visual layer is absent. Treat unresolved anchors as historical requirements. Never reinterpret `[data-prd-annotator-ui]` controls, Drawer, markers, editor, or highlight as product UI.

After implementation, update annotation status/linkage only when the requirement is represented in the PRD, then run the gate.

## Remove the display layer safely

Follow this gate in order:

1. Capture the current snapshot before removing the integration.
2. Run the merge script.
3. Compare snapshot IDs with permanent page JSON; stop if any ID is missing.
4. Run the PRD gate.
5. Remove only the SDK script tag, import, or mount call.
6. Keep annotation JSON, page PRDs, total PRD, manifest, and browser cache unchanged.
7. Run the PRD gate again.

`unmount()` removes UI and listeners only. It never authorizes deletion of localStorage or project data.

## Hard rules

- Use no Python, Node, browser-extension, or cloud save service at runtime. The Agent writes project files during its normal work.
- Expose no delete, clear, purge, reset, or annotation-removal workflow.
- Never treat an empty snapshot as permission to empty permanent data.
- Never drop an annotation because its DOM target is stale.
- Never edit PRDs before merging an available current snapshot.
- Never mark an annotation `applied` without a non-empty linked PRD section.
- Never remove the display integration before the ID comparison and first gate pass.

## Drift checks

| Temptation | Correct interpretation |
|---|---|
| “The browser cache already has it.” | browser cache is a recovery layer; merge into permanent page JSON |
| “Ask the human to send the JSON.” | Read the mounted SDK snapshot directly |
| “A missing DOM target means the annotation is obsolete.” | Preserve the record; omit only its marker |
| “Removing the layer means cleaning its data.” | Remove visuals only; permanent data and cache remain |
| “This public change is visible on one page.” | Clear global impact still updates the total PRD |

## Stop signals

Stop and correct the workflow if any of these appear:

- A proposed save service or sync endpoint
- A copy-to-AI, import, export, or download step
- A file operation that empties or removes annotation or PRD data
- A visual-layer removal without snapshot merge and ID comparison
- An `applied` annotation without a linked PRD section
- A manifest page missing from the total PRD index

## Example

For “Please organize the current page annotations and update the PRD,” locate the page from the manifest, read its three permanent documents, inspect and merge the live snapshot, update the page PRD, update the total PRD only for clear global impact, set annotation linkage/status, run the gate, and report the resulting changes. Ask only if a specific annotation has genuinely ambiguous product meaning.

## Common mistakes

- Reading only localStorage: use the mounted snapshot when available and permanent files for durable state.
- Updating Markdown without JSON linkage: update `prd.summary`, `prd.linkedSections`, impact, and status together.
- Treating Skill invocation as a magic phrase: respond to semantic intent.
- Trusting visual presence as persistence: verify permanent files with the gate.
