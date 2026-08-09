# Global PRD Annotator Skill and SDK Design

Date: 2026-08-09

Status: Approved design

## 1. Purpose

PRD Annotator is a human-and-AI collaboration tool for static HTML prototypes. A human marks page elements and writes product feedback in the browser. An AI Agent persists those annotations, discovers and displays project documentation, and updates PRDs only when the user explicitly requests document work.

The product consists of:

- A globally installed `prd-annotator` Skill that manages installation, discovery, synchronization, document work, and gates.
- A project-local, single-file browser SDK that injects the annotation UI into prototype HTML.
- Project-local annotation data, a page/document manifest, and generated Drawer view data.
- Existing project PRDs and requirement documents, which remain in their original locations.

The supported workflow is deliberately Agent-agnostic. Codex may be able to inspect a browser directly, while Qoder or another Agent may not. The SDK therefore supports both direct Agent inspection and a self-contained prompt containing the complete annotation payload.

## 2. Goals

- Install the Skill globally once and use it in any prototype repository.
- Install the SDK into a project only after the user explicitly chooses to use it.
- Discover prototype source HTML and inject one local SDK reference into every authorized prototype page.
- Keep page identities short, stable, unique, and ASCII-only.
- Discover requirement and PRD assets throughout the project without assuming a fixed document directory.
- Display all relevant or ambiguous document candidates without choosing, merging, or overwriting them.
- Preserve annotations in browser storage immediately and in project JSON after Agent synchronization.
- Make the browser-to-Agent synchronization flow understandable to users who do not know the SDK architecture.
- Remove the visual layer without deleting annotations, PRDs, the manifest, view data, or browser cache.
- Enforce installation, path, annotation, document, PRD, and removal gates.

## 3. Non-goals

- No Python, Node, extension, cloud, or local save service runs while the prototype is being annotated.
- The SDK does not write project files.
- A static page does not claim that it can wake or command every AI Agent directly.
- Installing the SDK does not automatically create or modify PRDs.
- Document discovery does not select an authoritative PRD.
- The SDK provides no delete, purge, reset, or clear-data workflow.
- The SDK is for prototype HTML only, not production frontend code or generated build output.

## 4. Chosen architecture

Use a hybrid architecture: the global Skill is the control plane, and each authorized prototype project contains a local SDK and data plane.

### 4.1 Global Skill responsibilities

The global Skill:

- Interprets user intent semantically; it does not require a magic trigger phrase.
- Enforces explicit authorization before installation.
- Finds the project root, prototype source HTML, existing integrations, requirement documents, PRDs, and legacy annotation data.
- Downloads the latest formal GitHub Release when the SDK is missing.
- Records and validates the installed SDK version, release source, and checksum.
- Assigns project and page identities.
- Creates and updates the project manifest.
- Calculates and validates every HTML-relative SDK and view path.
- Generates page-specific Drawer view bundles.
- Synchronizes live or pasted annotations into permanent page JSON.
- Performs PRD work only within the user's request and the document-selection rules below.
- Runs all gates before reporting success.
- Removes only the display integration when the user explicitly requests removal.

Skill scripts must resolve their own directory from the globally installed Skill location. They must not assume that a project contains a copy of the Skill or invoke scripts through a hard-coded project-relative path.

For Codex, the distributable Skill is installed in the user's global Agent skills directory (for example `$HOME/.agents/skills/prd-annotator`). Other Agents may use a different global Skill location, but the project-local SDK and data contract remains the same.

### 4.2 Project-local layout

After authorized installation, a target project contains:

```text
.prd-annotator/
├── manifest.json
├── sdk/
│   └── prd-annotator.js
├── data/
│   └── pages/
│       └── <page-id>.json
└── view/
    └── pages/
        └── <page-id>.js
```

The files have these roles:

- `manifest.json` is the project asset map. It records installation metadata, prototype pages, identities, annotation files, view files, and discovered documents.
- `sdk/prd-annotator.js` is the locally installed Release asset.
- `data/pages/<page-id>.json` is the permanent annotation record for exactly one page.
- `view/pages/<page-id>.js` is generated display data containing persisted annotations, associated document contents, source paths, fingerprints, and the last persisted annotation fingerprint.

The generated view bundle is not authoritative. It must be reproducible from the manifest, page JSON, and source documents. JavaScript is used instead of runtime JSON or Markdown fetches because `file://` pages do not reliably permit those fetches. The SDK can load a local JavaScript view bundle without a save service.

Existing PRDs and requirement documents remain in their current locations. The Skill does not move or copy them merely to standardize the project.

## 5. Authorization boundary

Finding HTML, annotations, or PRD documents does not authorize installation.

- A direct user request to install, enable, add, or use PRD Annotator is authorization and does not need a second confirmation.
- A question about whether the SDK could be used permits read-only inspection only. The Agent must describe the expected changes and wait for confirmation.
- Generic prototype building, frontend editing, or PRD writing must not cause SDK installation.
- A valid existing `.prd-annotator/manifest.json` records that the project was previously enabled. Annotation-related maintenance may use the existing integration without asking to install again.
- SDK upgrades and display-layer removal still require explicit user intent.

Without authorization, the Skill must not download assets, create `.prd-annotator`, or modify HTML.

## 6. Release and upgrade policy

The unique official distribution repository is:

```text
https://github.com/Byron1017/prdAnnotatorSDK-Skill
```

When an authorized project has no SDK:

1. Resolve the latest formal GitHub Release.
2. Download the published SDK asset and checksum metadata.
3. Verify integrity before writing the SDK into the project.
4. Record version, release URL, checksum, and installation time in the manifest.

Routine installation must not download raw `master`. An existing SDK is never overwritten automatically. Upgrade happens only after an explicit user request and must validate the new asset before replacing the old SDK.

## 7. Prototype discovery and exclusions

After authorization, the Skill scans source HTML while excluding at least:

- `.git`
- `.prd-annotator`
- `node_modules`
- `dist`
- `build`
- `out`
- `vendor`
- `coverage`
- generated test and build artifacts

If a repository mixes prototypes and production pages and the scope cannot be identified reliably, the Agent must ask the user which pages are prototypes. It must not inject all HTML by guessing.

## 8. Project and page identity

All generated identity values and filenames use lowercase ASCII letters, digits, and hyphens.

### 8.1 Page ID priority

1. Preserve an existing valid manifest mapping.
2. Preserve an existing valid `data-page-id` on the SDK script.
3. Otherwise derive a concise slug from the HTML filename or the nearest usable ASCII directory name and append a six-character hash of the normalized project-relative HTML path.
4. If no usable ASCII slug exists, use `page-<hash>`.

Examples:

```text
equipment-ops-7c31fa
page-7c31fa
```

Page IDs are at most 32 characters. The first installation writes the resulting ID explicitly into the HTML script tag, so moving the HTML with that tag does not change the ID. A deep path is stored only as a manifest field and does not become part of an annotation filename.

Project identity follows the same ASCII-only principle and is persisted in the manifest. Browser storage uses a namespace composed from project ID and page ID.

## 9. HTML injection and path gate

Each prototype HTML receives exactly one local SDK script, conceptually:

```html
<script src="../../.prd-annotator/sdk/prd-annotator.js" data-project-id="device-demo-a13f92" data-page-id="equipment-ops-7c31fa" data-view-src="../../.prd-annotator/view/pages/equipment-ops-7c31fa.js"></script>
```

The actual relative prefix is calculated separately from each HTML directory. HTML references use forward slashes.

Before installation is reported complete, the gate verifies:

- Every registered prototype page has exactly one SDK reference.
- `src` and `data-view-src` resolve from the HTML directory to real files.
- Both resolved files remain inside the project root.
- No absolute path, `file://` path, GitHub Raw URL, or CDN URL is used.
- The page ID matches the manifest, page JSON filename, and view filename.
- The SDK checksum and version match the manifest.
- Excluded build or third-party files were not injected.

Any failure blocks a success report and identifies the affected page.

## 10. Document discovery and inventory

The Skill searches the project for semantically relevant PRD, requirement, rule, and product-flow assets. It records, when available:

- Stable document ID
- Project-relative source path
- Display title
- Format
- Content fingerprint
- Candidate document kind
- Related page IDs and association evidence
- Preview status
- Missing or moved status
- Whether an association was discovered or manually specified

Candidate kinds are display labels only:

- Page PRD
- Total PRD
- Requirement or rule document
- Other related document
- Unclassified document

Classification does not create authority or priority. If several documents appear to be page or total PRDs, all are retained and shown. The Skill must not choose, merge, or overwrite them during discovery. Manual mappings in the manifest survive later scans.

Preview support:

- Markdown and plain text: full content.
- JSON and YAML: formatted content.
- PDF and Word: record the asset; include extracted text when the active Agent has extraction capability, otherwise show the path and `not previewable` state.
- A document that disappears is marked missing rather than silently removed from history.

SDK source, generated build output, and unrelated HTML are not requirement documents.

## 11. Drawer view generation

For each page, the Skill generates `view/pages/<page-id>.js` with:

- Page identity and source HTML path
- Persisted annotations and their fingerprint
- All directly associated documents
- Project-level PRDs and public-rule documents
- Other related or unclassified candidates
- Full previewable document content
- Source paths, formats, fingerprints, and preview states
- Generation time and schema version

The Drawer displays content in this order:

1. Current-page annotations
2. All directly associated page documents
3. Project-level PRDs and public-rule documents
4. Other related or unclassified document assets

Every document shows its source path. Markdown rendering must be sanitized; source document content must not execute HTML or script in the prototype.

If a view bundle is missing or stale, browser annotations remain available. The Drawer must warn that document content needs Agent regeneration instead of presenting stale content as current.

## 12. SDK UI and annotation behavior

The page has exactly two floating buttons:

- `标注模式`
- `PRD 标注`

No third floating action is added. Synchronization controls live inside the Drawer.

In annotation mode:

- Hover highlights a candidate DOM target.
- Clicking a target opens the annotation editor.
- Saving creates a colored numbered marker and a dashed target outline.
- Different annotation types may use different colors.
- A stale target remains valid historical data but has no marker until it can be resolved again.

Required annotation fields are:

- Stable annotation ID
- Title
- Description
- Type
- Associated target
- PRD content: the intended product requirement text, kept distinct from the human's explanatory comment
- Creation and update timestamps

Recommended fields are:

- Acceptance criteria
- Data fields
- API path
- Exception and boundary behavior

The target keeps several recovery signals, including CSS path, XPath, text quote, and captured rectangle. A target that no longer resolves is never a reason to delete an annotation.

All injected UI is marked with `[data-prd-annotator-ui]` and isolated from prototype styles where practical. The Skill tells the Agent to exclude these nodes from business UI analysis. Desktop uses a right Drawer; narrow screens use a scrollable near-full-width side or bottom panel.

## 13. Browser cache and synchronization

Every annotation change is immediately stored under a project-and-page-specific `localStorage` key. This survives ordinary page and browser closure but is only a recovery cache. Clearing browser data, changing browser profiles, private browsing, file moves, or browser-specific `file://` behavior can make it unavailable.

The permanent source is `data/pages/<page-id>.json`, written by an AI Agent.

### 13.1 Sync state

The SDK compares the current annotation fingerprint with the last persisted fingerprint in the view bundle.

- Matching fingerprints: `已同步到项目`.
- Different fingerprints: `仅保存在此浏览器，尚未同步到项目`.
- Storage failure: a blocking warning that the data exists only in current page memory and must be sent to an Agent before closing.

### 13.2 Universal synchronization flow

The Drawer explains:

1. Click `复制同步提示词`.
2. Return to the AI Agent that can write the current project.
3. Paste and send the prompt.
4. Wait for the Agent to report the files it wrote.
5. Refresh the prototype after the Agent regenerates the view bundle.

The page must say that copying is not synchronization and must not show a saved state merely because clipboard writing succeeded.

The copied prompt contains:

- A clear synchronization instruction
- Project ID and page ID
- Source HTML path
- Manifest, annotation JSON, and view target paths
- Complete current annotation JSON
- Current annotation fingerprint
- Merge and no-deletion rules
- Required post-write gates
- A request to report every changed file

Because the complete payload is embedded, an Agent with project-file access can synchronize without browser-control capability.

If an Agent can inspect the mounted page directly, it may call `window.PRDAnnotator.getSnapshot()` instead. This optimization must not be assumed for every Agent.

### 13.3 Permanent merge rules

- Merge only within the same project and page ID.
- Merge by stable annotation ID.
- For the same ID, prefer the newer `updatedAt` record.
- Retain every permanent-only annotation.
- Never interpret an empty browser snapshot as permission to empty permanent data.
- Never reduce the set of permanent annotation IDs during synchronization.
- Regenerate the page view and its persisted fingerprint after a successful write.

The default copied synchronization prompt does not edit PRDs.

## 14. PRD creation and update authorization

Installing or synchronizing PRD Annotator does not create or modify PRDs.

The user may request PRD work in any natural language. No formal phrase such as `本页标注` is required.

When PRD work is requested:

1. Read the current page JSON and all manifest-linked documents.
2. Use a document explicitly named by the user.
3. If exactly one target is unambiguous, use it.
4. If several targets are plausible, list all candidates and ask the user. Do not select, merge, or overwrite them.
5. For clear page-only impact, update the selected page PRD.
6. For clear public-rule, cross-page-flow, or total-scope impact, also update the already identified total PRD and report a change summary.
7. If the total PRD target is ambiguous, ask before editing.

If the project has no PRD:

- Do not create one during SDK installation.
- Create PRDs only after an explicit request.
- Reuse a unique existing PRD directory when one exists.
- Otherwise default to `doc/prd/pages/<page-id>.md` and `doc/prd/PRD.md`.
- Ask the user when several document roots are plausible.

For PRDs newly created and managed by this Skill, the page JSON stores the full structured PRD source. Page Markdown must be reproducible from that JSON. A Skill-managed total PRD must index every manifest page. Pre-existing external PRDs are inventoried and may be edited on request, but are not forced into the managed regeneration format.

## 15. Safe display-layer removal

Removal requires explicit user intent and follows this order:

1. Inspect the live annotation fingerprint or pasted snapshot.
2. Stop if annotations are unsynchronized.
3. Synchronize and confirm that permanent JSON contains every live annotation ID.
4. Run data, document, and PRD gates.
5. Remove only the SDK script reference or mount call from authorized prototype HTML.
6. Keep `.prd-annotator`, source documents, annotation JSON, view bundles, and browser cache.
7. Run the gates again.

`unmount()` removes UI, listeners, markers, and highlights only. It never authorizes data deletion.

## 16. Error handling

- GitHub Release unavailable: stop first installation and leave no broken HTML references.
- Release checksum mismatch: reject the asset.
- Invalid or corrupt manifest: stop before overwrite; report the issue and preserve the original file.
- Invalid relative path: identify the HTML and block completion.
- `localStorage` unavailable or full: keep the live in-memory payload and present the urgent copy-and-send workflow.
- Document parse failure: retain the asset entry and mark preview unavailable.
- Missing document: retain the historical manifest entry and mark it missing.
- Stale DOM target: retain the annotation and omit only its marker.
- Missing or stale view bundle: show a regeneration warning while preserving browser annotations.

No failure permits destructive cleanup or an unverified success report.

## 17. Gates

The gate checks at least:

- Installation authorization was present before project mutation.
- SDK Release metadata, version, and checksum are valid.
- Prototype scanning respected exclusions.
- Page IDs and generated filenames are unique, short, and ASCII-only.
- Every registered HTML has exactly one valid local SDK reference.
- Every relative reference resolves inside the project.
- Every page has exactly one permanent annotation JSON file and one generated view file.
- Required annotation fields and target recovery signals are present.
- Synchronization did not reduce permanent annotation IDs.
- All discovered related documents appear in the manifest.
- View document fingerprints match current source files or are explicitly marked stale/missing.
- A Skill-managed page PRD can be regenerated from page JSON.
- A Skill-managed total PRD indexes every manifest page.
- Ambiguous document sets were not silently selected or merged.
- Unsynchronized annotations block display-layer removal.

## 18. Legacy migration

The current implementation assumes `doc/prd/manifest.json` and direct browser access. A revised Skill must detect that legacy layout.

Legacy migration occurs only during an explicitly authorized install or upgrade. It must:

- Read and preserve every legacy annotation and document.
- Create the new project manifest and canonical `.prd-annotator/data/pages` files without moving or deleting legacy sources.
- Record legacy source paths and fingerprints in migration metadata.
- Catalog existing PRDs in their original locations.
- Verify annotation ID parity before treating migration as complete.

Legacy source files remain untouched. The system provides no automatic deletion step for them.

## 19. Verification strategy

Unit and integration coverage includes:

- Identity generation, including Chinese filenames, missing ASCII slugs, duplicate names, and deep paths.
- Project-relative path calculation from nested HTML directories.
- Scan exclusions and mixed prototype/production ambiguity.
- Release selection, checksum validation, existing-version preservation, and explicit upgrade.
- Manifest creation, refresh, manual mapping preservation, and legacy migration.
- Document discovery, ambiguous candidates, missing documents, and preview states.
- Annotation field validation, stale targets, page isolation, merge monotonicity, and empty snapshots.
- Complete universal sync-prompt payloads and clipboard status messages.
- View generation, fingerprint comparison, stale-view warnings, and sanitized Markdown rendering.
- Managed page and total PRD regeneration gates.
- Safe display-layer removal.

End-to-end coverage includes:

- Direct `file://` static HTML where supported by the test browser.
- Ordinary local HTTP serving without a save endpoint.
- Desktop and narrow-screen Drawers.
- Exactly two floating buttons.
- Annotation creation, browser reload, copied prompt generation, Agent-style merge, view regeneration, and synchronized status after refresh.
- Nested pages with different relative SDK paths.
- SDK removal with all data retained.

Repository checks include Skill validation, ASCII-only tracked paths, a scan for save services and destructive data workflows, and the complete existing unit and Playwright suites.

## 20. Acceptance summary

The design is accepted when:

- The Skill never installs merely because it sees prototype HTML.
- Authorized installation is local, Release-pinned, checksum-verified, and path-gated.
- Static prototype pages expose exactly two floating controls.
- Humans can annotate and see all relevant PRD/document candidates in the Drawer.
- Browser data is visibly distinguished from project-persisted data.
- Any capable project-writing AI Agent can synchronize using the complete copied prompt.
- No Agent silently selects or merges ambiguous PRDs.
- Removing the display layer leaves every annotation and document asset intact.
