# PRD Annotator data schema

## Contents

1. Permanent layout
2. Manifest
3. Page annotation document
4. Browser snapshot
5. Field rules
6. Invariants

## 1. Permanent layout

Store durable project data under the project root:

```text
doc/prd/
├── manifest.json
├── data/pages/<page-id>.json
├── pages/<page-id>.md
└── PRD.md
```

Use ASCII file and directory names. A page ID contains only lowercase letters, digits, and hyphens and is at most 40 characters.

## 2. Manifest

`doc/prd/manifest.json` is the page registry:

```json
{
  "schemaVersion": 1,
  "pages": [
    {
      "id": "equipment-ops",
      "title": "Equipment Operations",
      "route": "/equipment/ops",
      "annotationFile": "data/pages/equipment-ops.json",
      "prdFile": "pages/equipment-ops.md"
    }
  ]
}
```

Rules:

- Keep page IDs and normalized routes unique.
- Set `annotationFile` to `data/pages/<page-id>.json`.
- Set `prdFile` to `pages/<page-id>.md`.
- Include every manifest page in `doc/prd/PRD.md` as `[Title](pages/<page-id>.md)`.
- Add new pages; do not silently replace an existing route-to-ID mapping.

## 3. Page annotation document

Each page owns one independent JSON document:

```json
{
  "schemaVersion": 1,
  "page": {
    "id": "equipment-ops",
    "title": "Equipment Operations",
    "route": "/equipment/ops"
  },
  "annotations": [
    {
      "id": "A001",
      "comment": "Add a batch-disable entry point.",
      "status": "open",
      "createdAt": "2026-08-08T10:00:00.000Z",
      "updatedAt": "2026-08-08T10:00:00.000Z",
      "target": {
        "cssPath": "main > section:nth-of-type(1)",
        "xpath": "/html/body/main/section[1]",
        "textQuote": "Equipment list",
        "rect": {
          "x": 220,
          "y": 180,
          "width": 860,
          "height": 420
        }
      },
      "prd": {
        "linkedSections": [],
        "impactScope": "page",
        "summary": ""
      }
    }
  ]
}
```

## 4. Browser snapshot

`window.PRDAnnotator.getSnapshot()` returns:

```json
{
  "schemaVersion": 1,
  "projectKey": "device-demo",
  "document": {
    "schemaVersion": 1,
    "page": {
      "id": "equipment-ops",
      "title": "Equipment Operations",
      "route": "/equipment/ops"
    },
    "annotations": []
  },
  "pagePrdMarkdown": "# Equipment Operations"
}
```

The browser snapshot is an input to the permanent merge. It is not authoritative enough to remove permanent records.

## 5. Field rules

### Annotation fields

| Field | Required | Rule |
|---|---:|---|
| `id` | yes | Stable within the page, normally `A001`, `A002`, and so on |
| `comment` | yes | Non-empty human annotation |
| `status` | yes | One allowed value below |
| `createdAt` | yes | ISO timestamp |
| `updatedAt` | yes | ISO timestamp used for same-ID conflict resolution |
| `target` | yes | Preserve even when the target no longer resolves |
| `prd.linkedSections` | yes | Array; non-empty when status is `applied` |
| `prd.impactScope` | yes | `page` or `global` |
| `prd.summary` | yes | AI-authored change summary or empty string |

Allowed statuses:

- `open`
- `needs-clarification`
- `applied`
- `superseded`

Allowed impact scopes:

- `page`: affects only this page PRD.
- `global`: affects public rules, total scope, or a cross-page flow and therefore also updates the total PRD.

### Target fields

Keep all four recovery signals:

- `cssPath`
- `xpath`
- `textQuote`
- `rect` with `x`, `y`, `width`, and `height`

An unresolved target remains valid historical data. Omit only its visual marker.

## 6. Invariants

1. Merge by annotation ID.
2. Add IDs found only in the incoming snapshot.
3. For the same ID, keep the record with the newer `updatedAt` value.
4. Never reduce the existing permanent annotation count.
5. Accept a valid new page with zero annotations.
6. Never merge different page IDs.
7. Never infer that an empty browser snapshot means permanent annotations should be removed.
8. Never erase annotation JSON, page PRD, total PRD, manifest, or browser cache while removing the display layer.
