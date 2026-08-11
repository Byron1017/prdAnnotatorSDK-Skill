# PRD Annotator SDK + Skill

PRD Annotator lets people mark static HTML prototypes in the browser while an AI Agent persists annotations, displays related project documents, and updates PRDs only when separately requested.

Version 2.1.0 adds physical-HTML plus Hash-route page identity, route-scoped annotation caches and Views, five fixed Drawer Tabs, and user-authorized field/API document workflows.

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

Every enabled prototype page has exactly two floating buttons:

- `标注模式` selects a business-page target and records a complete annotation.
- `PRD 标注` opens the Drawer with page identity, sync status, and five fixed Tabs: `本页标注`, `页面 PRD`, `关联文档`, `字段规范`, and `接口文档`.

Only one Tab panel is visible at a time. Document display groups are presentation metadata: one document may appear in several Tabs, and the SDK does not merge or choose among candidates for the user.

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

## Document selection and updates

Document work requires a separate natural-language request; no magic phrase is required. Installation, annotation creation, annotation synchronization, route refresh, and View refresh do not authorize document writes. The Agent uses an explicitly named or sole unambiguous target and follows the project's existing directory, filename, format, headings, tables, and terminology. If several page PRDs, total PRDs, field specifications, API documents, roots, or templates are plausible, it lists the candidates and asks instead of choosing or merging them.

Page-only impact updates only the selected page PRD. Public rules, cross-page flows, or total-scope changes also update an already identified total PRD. Existing external documents remain external; managed PRDs are generated only after explicit creation authorization. After an authorized write, the Agent refreshes the inventory and Views so the result appears in the matching Drawer Tab.

See [Route and document workflow](docs/route-and-document-workflow.md) for the complete multi-HTML, Hash-route, legacy-data, synchronization, and document-authorization rules.

## Safe display-layer removal

Removal requires explicit intent and one current snapshot or complete pasted payload for every target page. The Skill calls `remove-project.mjs --confirm-remove`, which synchronizes first, proves annotation retention, runs gates, removes only the selected HTML integration, and marks the page display disabled.

Removal keeps `.prd-annotator/`, SDK bytes, the manifest, annotation JSON, view bundles, source documents, PRDs, unresolved targets, and browser cache. There is no delete, purge, reset, or clear-data workflow.

## Development and verification

```powershell
npm run test:unit
npm run build
npm run test:e2e
npm run release:package
npm run check:repo
```

The repository scanner requires ASCII tracked paths and rejects runtime save services or destructive project-data workflows. It is a deterministic syntactic policy gate: it checks known runtime write transports, fetch options that are not provably read-only, destructive workflow names, basic filesystem aliases, and exact safe cleanup scopes. It does not claim perfect arbitrary-code semantic analysis; dynamically hidden behavior still requires review. The generated `dist/release/` directory is intentionally ignored; publish its three verified files as formal GitHub Release assets.
