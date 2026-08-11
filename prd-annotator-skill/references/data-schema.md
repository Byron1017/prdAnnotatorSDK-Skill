# PRD Annotator schema v2

## Contents

1. Project layout
2. Manifest
3. Page annotation document
4. Generated view bundle
5. Browser snapshot and copied payload
6. Invariants

## 1. Project layout

Keep durable integration data under the authorized project root:

```text
.prd-annotator/
├── manifest.json
├── sdk/prd-annotator.js
├── data/pages/<page-id>.json
└── view/
    ├── pages/<page-id>.js
    └── routes/<base-page-id>.js
```

Keep existing requirements and PRDs in their current project locations. Treat view bundles as generated display data, not an authoritative source.

## 2. Manifest

Use schema version `2`:

```json
{
  "schemaVersion": 2,
  "project": {
    "id": "device-demo-a13f92",
    "sdk": {
      "version": "2.2.0",
      "releaseUrl": "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.2.0",
      "sha256": "<64-lowercase-hex>",
      "installedAt": "2026-08-09T00:00:00.000Z"
    }
  },
  "pages": [
    {
      "id": "equipment-ops-7c31fa",
      "title": "Equipment Operations",
      "htmlPath": "prototype/index.html",
      "annotationFile": ".prd-annotator/data/pages/equipment-ops-7c31fa.json",
      "viewFile": ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
      "identity": { "mode": "document" },
      "routeRegistryFile": ".prd-annotator/view/routes/equipment-ops-7c31fa.js",
      "display": {
        "enabled": true,
        "updatedAt": "2026-08-09T00:00:00.000Z"
      }
    },
    {
      "id": "message-edit-31ab92",
      "title": "Message Edit",
      "htmlPath": "prototype/index.html",
      "annotationFile": ".prd-annotator/data/pages/message-edit-31ab92.json",
      "viewFile": ".prd-annotator/view/pages/message-edit-31ab92.js",
      "identity": { "mode": "hash-route", "routePattern": "/message/edit/:id" },
      "display": {
        "enabled": true,
        "updatedAt": "2026-08-09T00:00:00.000Z"
      }
    }
  ],
  "documents": [],
  "migration": null
}
```

Keep project/page/document IDs unique and ASCII-only. Limit page IDs to 32 characters. Resolve every relative path inside the project. Represent a physical HTML base page with `identity: { "mode": "document" }`; represent each registered Hash page with `identity: { "mode": "hash-route", "routePattern": "/message/edit/:id" }`. Page identity is project ID plus normalized HTML path plus the optional declared route pattern. Query parameters and live dynamic values never enter page IDs, filenames, or localStorage keys. Set `page.display.enabled` to `false` only through snapshot-verified removal; keep the page entry and all data files.

Document entries retain `id`, `path`, `title`, `format`, `kind`, optional `displayGroups`, `pageIds`, fingerprint, preview state, missing state, and association evidence/source. `displayGroups` may contain one or more of `page-prd`, `related`, `field-spec`, and `api-doc`; manual groups take precedence. Treat `kind` and display groups as presentation metadata, not authority. Preserve manual mappings and missing historical entries.

## 3. Page annotation document

Use one schema-v2 JSON file per page:

```json
{
  "schemaVersion": 2,
  "projectId": "device-demo-a13f92",
  "page": {
    "id": "equipment-ops-7c31fa",
    "title": "Equipment Operations",
    "htmlPath": "prototype/index.html",
    "route": "/prototype/index.html"
  },
  "annotations": [
    {
      "id": "A001",
      "title": "Batch disable",
      "description": "Add a batch action.",
      "type": "requirement",
      "prdContent": "Selected devices can be disabled together.",
      "acceptanceCriteria": "Confirm before changing state.",
      "dataFields": "deviceIds: string[]",
      "apiPath": "POST /api/devices/batch-disable",
      "edgeCases": "Reject an empty selection.",
      "status": "open",
      "createdAt": "2026-08-09T00:00:00.000Z",
      "updatedAt": "2026-08-09T00:00:00.000Z",
      "target": {
        "cssPath": "main",
        "xpath": "/html/body/main",
        "textQuote": "Equipment list",
        "rect": { "x": 0, "y": 0, "width": 100, "height": 40 }
      },
      "prd": {
        "linkedDocuments": [],
        "linkedSections": [],
        "impactScope": "page",
        "summary": ""
      }
    }
  ],
  "deletedAnnotations": [
    {
      "id": "A000",
      "deletedAt": "2026-08-09T01:00:00.000Z"
    }
  ],
  "managedPrd": null
}
```

Require non-empty `id`, `title`, `description`, `prdContent`, valid type/status, timestamps, and all target recovery signals. Allow annotation types `requirement`, `change`, `question`, and `bug`; statuses `open`, `needs-clarification`, `applied`, and `superseded`; scopes `page` and `global`.

`deletedAnnotations` contains explicit same-page tombstones. Each entry has exactly one non-empty annotation `id` and one canonical ISO-8601 `deletedAt` timestamp. Tombstone IDs must be unique and must not also appear in active `annotations`. A tombstone suppresses any matching active record during merge; omission never creates a tombstone. Schema-v2 documents created before this field existed may omit it and must be read as `deletedAnnotations: []`.

For fingerprint compatibility, fingerprint only `annotations` while there are no tombstones. Once at least one tombstone exists, fingerprint the object `{ annotations, deletedAnnotations }`. This preserves existing fingerprints for legacy v2 documents while binding explicit deletion intent in new snapshots and generated Views.

Store Skill-managed page PRD structure in `managedPrd`. Keep external PRDs outside this field.

## 4. Generated view bundle

Generate executable `window.PRDAnnotator.registerView(<bundle>);` data containing:

- `schemaVersion`, `generatedAt`, `projectId`, and page identity
- `persistedAnnotationFingerprint`
- the complete page annotation document
- every directly associated, project-level, public-rule, field specification, API document, related, or unclassified document entry, including its display groups
- preview content/status and source fingerprints

Inject the base View through `data-view-src` and the optional offline route registry through `data-route-src`. A route registry maps one physical HTML to its document page and evidence-backed Hash route templates; each logical page keeps its own annotation JSON and View. Mark stale, missing, or unavailable previews explicitly. Regenerate Views and route registries from manifest, page JSON, and source documents; never treat generated bundles as permanent data.

## 5. Browser snapshot and copied payload

Accept a direct `window.PRDAnnotator.getSnapshot()` object or the exact payload object between `---PRD_ANNOTATOR_PAYLOAD_START---` and `---PRD_ANNOTATOR_PAYLOAD_END---`.

Require project/page identity, manifest/annotation/view paths, annotation fingerprint, and the complete page document to agree with the manifest. Save the exact object to a temporary JSON file before calling `merge-annotations.mjs`; do not pass prose to that script.

## 6. Invariants

1. Merge only within the same project and page.
2. Merge by stable annotation ID and prefer strictly newer `updatedAt` values.
3. Preserve every permanent-only ID and every unresolved target unless an explicit same-page tombstone exists for that ID.
4. Reduce active annotations only for matching explicit tombstones. Never infer deletion from omission, an empty snapshot, a missing DOM target, or display-layer removal.
5. Keep SDK version, Release URL, checksum, and installation time in the manifest.
6. Keep exactly one local SDK script on each enabled physical HTML and zero on disabled HTML pages.
7. Require `src`, `data-view-src`, and optional `data-route-src` to resolve inside the project.
8. Keep all discovered or missing document candidates visible in the inventory.
9. Apply managed PRD regeneration checks only to Skill-managed files.
10. Delete no project data during display-layer removal; preserve existing tombstones and never invent new ones.
11. Keep ordinary anchors on the document page, quarantine unregistered `#/...` routes, and preserve legacy annotations as unassigned instead of copying them to a logical route.
