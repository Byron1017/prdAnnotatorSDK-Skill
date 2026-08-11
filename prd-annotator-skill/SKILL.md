---
name: prd-annotator
description: Use when a user wants to install, inspect, synchronize, maintain, remove, or use PRD Annotator with static HTML prototypes, browser annotations, project PRDs, or related requirement documents.
---

# PRD Annotator

## Core rule

Treat the global Skill as the control plane, `.prd-annotator/manifest.json` as the project registry, and the target project's `.prd-annotator/` directory as durable annotation data. Keep browser runtime service-free. Require explicit user authorization before installing, upgrading, creating or editing any document, or removing the display layer.

Infer intent semantically. Require no magic phrase. Distinguish annotation synchronization from document work: annotation synchronization alone must never create or edit a document.

## Resolve the tools

Always resolve scripts relative to this Skill directory. Set an absolute `<skill-dir>` to the directory containing this `SKILL.md`, then invoke `<skill-dir>/scripts/*.mjs`. Never resolve scripts from the target project and never require the target project to contain a Skill copy.

Read these references when their subject applies:

- Read [references/installation.md](references/installation.md) for global installation, project discovery, SDK installation, Release, upgrade, and path rules.
- Read [references/data-schema.md](references/data-schema.md) before reading, writing, or validating manifest, page, view, snapshot, or prompt data.
- Read [references/prd-workflow.md](references/prd-workflow.md) before synchronization, PRD work, document selection, migration, or removal.

## Follow the control flow

1. Infer whether the user intends inspection, installation, route registration, synchronization, document work, upgrade, restoration, or removal.
2. Locate the target project. If integration is absent or unclear, run read-only `discover-project.mjs` first.
3. Install only after explicit user authorization. A direct request to install, enable, add, or use PRD Annotator is authorization; a question about feasibility is not.
4. Resolve every command from `<skill-dir>/scripts`, never a project-relative Skill path.
5. If the SDK is missing, obtain only the latest formal GitHub Release through `install-project.mjs --confirm-install`. Never use raw `master`. Never overwrite or upgrade an installed SDK without separate authorization and `--confirm-upgrade`.
6. Pass only explicitly selected prototype source pages to installation. Scan and inventory all relevant project documents. Keep every plausible candidate without choosing or merging for the user.
7. Synchronize from `window.PRDAnnotator.getSnapshot()` when direct page access is available. Otherwise accept the complete annotation payload copied with `复制同步提示词`.
8. For Hash Router prototypes, inspect declared Vue Router or equivalent source routes, preserve declared `:parameters`, and register only evidence-backed route templates through `set-routes.mjs --confirm-route-write`.
9. Run `refresh-project.mjs` when document/view regeneration is needed, then run `check-project.mjs` after annotation, route, view, or document changes.
10. Create or edit a page PRD, total PRD, field specification, API document, or related document only on separate user intent. Use an explicitly named or sole unambiguous target; do not choose or merge ambiguous documents. List plausible candidates and ask.
11. Remove only on explicit removal intent. Obtain one current identity-matched snapshot per target page, then call `remove-project.mjs --confirm-remove`. Never remove an integration directly.

## Discover and install safely

Run discovery without mutation:

```powershell
node "<skill-dir>/scripts/discover-project.mjs" --project-root "<project-root>"
```

If prototype scope is ambiguous, list project-relative HTML candidates and ask the user to choose. Do not infer that HTML or PRD files authorize installation.

After authorization, pass every selected page explicitly:

```powershell
node "<skill-dir>/scripts/install-project.mjs" `
  --project-root "<project-root>" `
  --confirm-install `
  --page "prototype/index.html"
```

Add `--confirm-upgrade` only after an explicit upgrade request. Require each physical HTML to contain exactly one local SDK script with `data-project-id`, `data-page-id`, `data-view-src`, and optional `data-route-src`. If a selected HTML uses Hash routing, follow the route discovery and registration workflow in [references/installation.md](references/installation.md). Require every resolved SDK, route registry, and View path to stay inside the project.

## Synchronize annotations

Prefer a direct current snapshot. If browser access is unavailable, instruct the user to:

1. Open `PRD 标注` on the target page.
2. Click `复制同步提示词`.
3. Return to the AI Agent that can write the project.
4. Paste and send the complete prompt.
5. Wait for the Agent's changed-file report, then refresh the prototype.

State that copying is not synchronization. Do not report synchronization until permanent page JSON and the view bundle are written and the gate passes.

Extract the exact JSON object from the prompt's payload delimiters into an Agent-controlled temporary file. Do not summarize or reconstruct it. The prompt supplies the complete annotation payload for Agents without browser access.

```powershell
node "<skill-dir>/scripts/merge-annotations.mjs" `
  --project-root "<project-root>" `
  --snapshot "<snapshot-or-payload.json>"

node "<skill-dir>/scripts/refresh-project.mjs" --project-root "<project-root>"
node "<skill-dir>/scripts/check-project.mjs" --project-root "<project-root>"
```

Preserve permanent-only IDs, stale targets, and newer records. Treat an empty browser snapshot as non-destructive input, never permission to erase permanent data.

## Handle document intent separately

Accept natural-language document requests; require no special phrase. Read the merged logical-page JSON and manifest-linked document inventory first.

- Use the document explicitly named by the user.
- Use a sole unambiguous target when exactly one exists.
- List paths, titles, kinds, and evidence and ask when several targets are plausible.
- For PRD candidates, do not choose or merge ambiguous PRDs.
- Write only the requested page PRD, total PRD, field specification, API document, or related document.
- Update only the selected page PRD for clear page-only impact.
- Also update the already identified total PRD for clear public-rule, cross-page-flow, or total-scope impact, and report a change summary.
- Stop and ask when the total PRD target is ambiguous.
- Create no document unless explicitly requested. Reuse one unambiguous same-kind directory and structure; default new managed PRDs to `doc/prd/` only when no PRD root exists; ask when several roots exist.
- Preserve external PRDs as external. Use `generate-prd.mjs --confirm-prd-write` only for Skill-managed PRDs.

Refresh views and run `check-project.mjs` after PRD or annotation-linkage changes.

## Remove the display layer safely

Require explicit removal authorization and one current snapshot per target page. If direct access is unavailable, use one complete pasted sync payload per page and stop until all snapshots are current.

```powershell
node "<skill-dir>/scripts/remove-project.mjs" `
  --project-root "<project-root>" `
  --confirm-remove `
  --page "<page-id>" `
  --snapshot "<current-snapshot.json>"
```

Let the orchestrator merge snapshots, verify retention, regenerate views, run the pre-removal gate, remove only HTML display integration, set `page.display.enabled` to `false`, and run the post-removal gate. Keep `.prd-annotator/`, SDK bytes, manifest, page JSON, views, source documents, PRDs, stale targets, and browser cache.

Never manually delete an SDK tag, import, or mount call. Run removal only in a trusted local project environment. The project lock coordinates cooperating AI and CLI writers, but portable Node 20 cannot guarantee hostile-process junction swaps between validation and a filesystem operation.

## Stop signals

Stop and correct the workflow if any of these occur:

- Installation without explicit authorization
- A raw-branch SDK download, implicit upgrade, or SDK overwrite
- A script resolved from the target project instead of this Skill directory
- A guessed prototype page or ambiguous PRD selection
- A copied prompt reported as synchronized before file writes and gates
- Document writes caused only by installation, annotation creation, annotation synchronization, route refresh, or View refresh
- Manual HTML integration removal or any project-data deletion
- A success report before `check-project.mjs` passes
