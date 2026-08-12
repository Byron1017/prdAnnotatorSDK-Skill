# PRD Annotator SDK + Skill

PRD Annotator lets people mark static HTML prototypes in the browser while an AI Agent persists annotations, displays related project documents, and updates PRDs only when separately requested.

Version 2.5.1 makes the Page PRD secondary switch a flat inline control that scrolls with the document, while keeping the five top-level Drawer Tabs sticky and preserving all annotation, document, storage, routing, and synchronization behavior from 2.5.0.

Version 2.5.0 adds page-scoped PRD, Field specification, API, and supplement views plus a four-card global document hub, while preserving the simplified five-field annotation form and historical synchronization compatibility introduced in 2.4.0. Annotation synchronization still never authorizes document changes.

Version 2.3.0 added per-card annotation editing and explicit deletion, monotonic `deletedAnnotations` tombstones, stable marker numbers that are never reused or renumbered, and a strict rule that editing or deleting an annotation does not authorize PRD changes.

Version 2.2.0 added the project-persistent collapsible launcher, a strict `24 × 44px` right-edge handle, keyboard and screen-reader support, and storage-failure fallback without changing annotation or document data.

Version 2.1.0 added physical-HTML plus Hash-route page identity, route-scoped annotation caches and Views, five fixed Drawer Tabs, and user-authorized field/API document workflows.

## Distribution

- Official source: <https://github.com/Byron1017/prdAnnotatorSDK-Skill>
- Global Codex Skill: install the complete `prd-annotator-skill/` directory at `$HOME/.agents/skills/prd-annotator/` and invoke it as `$prd-annotator`.
- Browser SDK source/build: `prd-annotator/prd-annotator.js`.
- Release assets: generate `dist/release/prd-annotator.js`, `prd-annotator.js.sha256`, and `release-manifest.json` with `npm run release:package`.

Installing the global Skill does not install anything into a project. Each project requires explicit user authorization before the Agent passes `--confirm-install`. A question about whether PRD Annotator could be used permits read-only discovery only.

On first authorized installation, the Skill downloads only the latest formal GitHub Release and verifies its SHA-256. It never uses raw `master`. An existing SDK is reused and is never upgraded or overwritten without a separate explicit request and `--confirm-upgrade`.

## Project data

An authorized project keeps its integration data here:

```text
.prd-annotator/
├── manifest.json
├── sdk/prd-annotator.js
├── data/pages/<page-id>.json
└── view/
    ├── pages/<page-id>.js
    └── routes/<base-page-id>.js
```

`manifest.json` records Release metadata, physical HTML files, logical Hash pages, display state, and every discovered document. Every logical page owns one page JSON and one View. Page JSON is the permanent annotation source. View and route JavaScript are regenerated display data that works on static pages without a save service. Existing PRDs and other documents remain in their original project locations.

## Page and route identity

The stable identity is `projectId + normalizedHtmlPath + optionalRoutePattern`.

- Different HTML addresses remain different pages.
- A Vue-style Hash route such as `#/message/edit/123` uses the declared template `/message/edit/:id`; live IDs never enter page IDs or filenames.
- Query values do not affect identity.
- An ordinary anchor such as `#section` remains on the base HTML page.
- A direct deep link loads the offline registry from `data-route-src` before selecting the page View.
- An unknown `#/...` route receives its own quarantined browser cache and never displays another page's annotations or documents.
- Projects without a router continue to use one document page per HTML file.

When logical routes are introduced into an older page, existing annotations remain retained as `legacy-unassigned`; the Agent does not guess which new route owns them.

## Browser workflow

Every enabled prototype page has one floating launcher containing exactly two business buttons:

- `标注模式` selects a business-page target and records a complete annotation.
- `PRD 标注` opens the Drawer with page identity, sync status, and five fixed Tabs in this order: `本页标注`, `页面 PRD`, `页面字段规范`, `页面接口文档`, and `关联文档`.

Only one Tab panel is visible at a time. `页面 PRD` keeps a top-visible secondary switch between `页面 PRD` and `本页补充资料 <count>`, so supplements remain reachable without scrolling through a long PRD. Page PRDs, Field specifications, API documents, and supplements appear only when their `scope: page` mapping includes the current physical HTML or registered Hash-route page.

`关联文档` is the final project-wide entry page with four cards: `总需求文档`, `总 PRD 文档`, `总字段规范`, and `总接口文档`. Each detail separates `全局文档` from `待关联候选`. Page-scoped documents never enter this hub; unassigned candidates never appear as global documents. The SDK displays every retained candidate and does not merge or choose documents for the user.

Each annotation card provides Edit and Delete actions. New and edited annotations use title, description, type, PRD content, and optional note. Editing changes only those five fields and preserves the annotation ID, target, creation time, status, PRD linkage, and any historical or unknown fields. Deletion requires an accessible confirmation and records an explicit same-page tombstone in `deletedAnnotations`. Surviving marker numbers remain stable, and deleted IDs are never reused. Omission, an empty snapshot, a missing DOM target, and display-layer removal never imply annotation deletion.

Use the narrow right-side control to collapse the two buttons when they cover prototype content. Collapsed mode leaves a `24 × 44px` handle at the right viewport edge; activate that handle by pointer, Enter, or Space to expand the launcher. The choice is remembered for every physical HTML page and registered Hash route that shares the same project ID.

Collapsing changes only the launcher display. It does not disable an active annotation mode, close the Drawer or annotation editor, alter annotations or PRDs, add launcher state to snapshots or synchronization prompts, or remove the SDK.

The SDK saves immediately to browser `localStorage` as a recovery cache. It does not write project files and runs no Python, Node, extension, cloud, or local save service while the page is being annotated.

## Synchronize with any project-writing Agent

When the current Agent cannot inspect the browser directly:

1. Open `PRD 标注` and click `复制同步提示词`.
2. Return to the AI Agent that can write the project.
3. Paste and send the complete prompt.
4. Wait for the Agent to report every file it wrote.
5. Refresh the prototype after the Agent regenerates the view bundle.

Copying is not synchronization. The project is synchronized only after the Agent merges the payload into page JSON, regenerates the view, and passes the project gate.

The prompt embeds the complete annotation payload—identity, paths, fingerprint, fields, targets, and merge rules—so Agents without browser-control capability can synchronize without retyping or losing data. The default synchronization flow never edits a PRD.

After editing or deleting in the Drawer, copy and send the synchronization prompt to the project-writing Agent. The Agent merges active annotations and explicit tombstones, refreshes the generated View, and runs the gate. If PRD content should change as a result, request that separately: annotation editing or deletion does not authorize PRD changes.

## Document selection and updates

Document work requires a separate natural-language request; no magic phrase is required. Installation, annotation creation, annotation synchronization, route refresh, and View refresh do not authorize document writes or re-scoping. The Agent resolves document kind and ownership separately. Clear page work maps to the named logical page; clear total/project work maps to global scope; a document without ownership evidence remains a candidate. Directory proximity, filename similarity, and the current open page are not ownership evidence. If page and global scope or several targets, roots, or templates are plausible, the Agent lists the candidates and asks instead of choosing or merging them.

Page-only impact updates only the selected page PRD. Page Field/API documents describe one physical HTML or registered Hash-route page; total Field/API documents provide project-wide indexes and shared contracts. Public rules, cross-page flows, or total-scope changes also update an already identified total PRD. Existing external documents remain external; managed PRDs are generated only after explicit creation authorization. After an authorized write, the Agent refreshes the inventory and Views so the result appears in the correct page Tab or global card.

See [Route and document workflow](docs/route-and-document-workflow.md) for the complete multi-HTML, Hash-route, legacy-data, synchronization, and document-authorization rules.

## Safe display-layer removal

Removal requires explicit intent and one current snapshot or complete pasted payload for every target page. The Skill calls `remove-project.mjs --confirm-remove`, which synchronizes first, proves annotation retention, runs gates, removes only the selected HTML integration, and marks the page display disabled.

Removal keeps `.prd-annotator/`, SDK bytes, the manifest, annotation JSON, explicit tombstones, view bundles, source documents, PRDs, unresolved targets, and browser cache. It never invents tombstones. There is no project-data purge, reset, or clear-data workflow.

## Development and verification

```powershell
npm run test:unit
npm run build
npm run test:e2e
npm run release:package
npm run check:repo
```

The repository scanner requires ASCII tracked paths and rejects runtime save services or destructive project-data workflows. It is a deterministic syntactic policy gate: it checks known runtime write transports, fetch options that are not provably read-only, destructive workflow names, basic filesystem aliases, and exact safe cleanup scopes. It does not claim perfect arbitrary-code semantic analysis; dynamically hidden behavior still requires review. The generated `dist/release/` directory is intentionally ignored; publish its three verified files as formal GitHub Release assets.
