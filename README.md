# PRD Annotator SDK + Skill

PRD Annotator lets people mark static HTML prototypes in the browser while an AI Agent persists annotations, displays related project documents, and updates PRDs only when separately requested.

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
└── view/pages/<page-id>.js
```

`manifest.json` records Release metadata, prototype pages, display state, and every discovered document. Page JSON is the permanent annotation source. View JavaScript is regenerated display data that works on static pages without a save service. Existing PRDs remain in their original project locations.

## Browser workflow

Every enabled prototype page has exactly two floating buttons:

- `标注模式` selects a business-page target and records a complete annotation.
- `PRD 标注` opens the Drawer with annotations, related document candidates, sync status, and the synchronization action.

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

## PRD selection and updates

PRD work requires a separate natural-language request; no magic phrase is required. The Agent uses an explicitly named or sole unambiguous target. If several page PRDs, total PRDs, or document roots are plausible, it lists the candidates and asks instead of choosing or merging them.

Page-only impact updates only the selected page PRD. Public rules, cross-page flows, or total-scope changes also update an already identified total PRD. Existing external PRDs remain external; generated managed PRDs are used only after explicit creation authorization.

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

The repository scanner requires ASCII tracked paths and rejects runtime save services or destructive project-data workflows. The generated `dist/release/` directory is intentionally ignored; publish its three verified files as formal GitHub Release assets.
