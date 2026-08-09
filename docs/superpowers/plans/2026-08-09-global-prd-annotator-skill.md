# Global PRD Annotator Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing page-only SDK and fixed-layout Skill into a consent-gated global Skill that installs a Release-pinned local SDK, inventories arbitrary project PRDs, displays all candidates, and synchronizes complete annotations through any project-writing AI Agent.

**Architecture:** Keep the browser SDK as a service-free UI and recovery cache. Put deterministic installation, project discovery, manifest/view generation, merging, PRD generation, migration, and gates in scripts shipped inside the globally installed Skill. Store only the SDK, manifest, per-page JSON, and generated view bundles under each authorized project's `.prd-annotator/` directory while leaving source documents where they already live.

**Tech Stack:** JavaScript ES2022, Node.js 20.11+, browser DOM/Shadow DOM/localStorage, Vitest 3.2.4 with jsdom, Playwright 1.55.0, esbuild 0.25.9, Markdown, JSON, GitHub Releases.

## Global Constraints

- Never install merely because HTML or PRD files are present; project mutation requires an explicit user request and the CLI flag `--confirm-install`.
- Download only the latest formal Release from `https://github.com/Byron1017/prdAnnotatorSDK-Skill` when the SDK is missing; never use raw `master` for routine installation.
- Record SDK version, Release URL, SHA-256, and installation time; never overwrite an existing SDK without explicit upgrade authorization and `--confirm-upgrade`.
- Inject prototype source HTML only; exclude `.git`, `.prd-annotator`, `node_modules`, `dist`, `build`, `out`, `vendor`, `coverage`, and generated test/build artifacts.
- Keep project/page IDs and generated filenames ASCII-only; page IDs are at most 32 characters.
- Every registered HTML has exactly one local SDK `<script>` with `data-project-id`, `data-page-id`, and `data-view-src`; all relative paths must resolve inside the project.
- Keep exactly two floating buttons: `标注模式` and `PRD 标注`; the sync control lives inside the Drawer.
- Use no Python, Node, browser-extension, cloud, or local save service at annotation runtime. Node scripts run only as Agent work.
- `localStorage` is a recovery cache. `.prd-annotator/data/pages/<page-id>.json` is the permanent annotation source.
- The universal copied prompt contains the complete current annotation payload. Copying must never be reported as successful synchronization.
- Document discovery lists all plausible PRDs and never selects, merges, moves, or overwrites them.
- The default sync prompt writes annotations and regenerates view data only; PRD edits require separate user intent.
- Expose no delete, clear, purge, or reset API or workflow. Never reduce permanent annotation IDs.
- Removing the display layer removes HTML injection/UI only and keeps project data, source documents, view bundles, and browser cache.
- Preserve current package floors and pins: Node `>=20.11`, Vitest `3.2.4`, Playwright `1.55.0`, esbuild `0.25.9`, jsdom `26.1.0`.
- Use schema version `2` and SDK/package version `2.0.0` for the breaking data and installation contract.

---

## Planned File Structure

### Browser SDK

- `prd-annotator/src/constants.js` — SDK/schema versions, storage prefixes, allowed annotation values.
- `prd-annotator/src/fingerprint.js` — canonical JSON and browser/Node-compatible annotation fingerprints.
- `prd-annotator/src/identity.js` — ASCII cleanup and browser-side explicit identity resolution.
- `prd-annotator/src/model.js` — schema-v2 annotation/view normalization, validation, and monotonic merges.
- `prd-annotator/src/storage.js` — page-isolated storage, v1 recovery fallback, and memory-only status.
- `prd-annotator/src/sync-prompt.js` — self-contained Agent prompt generation.
- `prd-annotator/src/view-data.js` — view-bundle validation and dynamic local script loading.
- `prd-annotator/src/runtime/controller.js` — SDK state machine, annotation creation, view hydration, sync state, clipboard flow.
- `prd-annotator/src/ui/editor.js` — complete annotation form.
- `prd-annotator/src/ui/drawer.js` — annotations, document groups, sync status, and instructions.
- `prd-annotator/src/ui/shell.js` — exactly two floating controls plus Drawer/editor containers.
- `prd-annotator/src/ui/styles.js` — desktop/mobile styling and type colors.
- `prd-annotator/src/ui/overlay.js` — target highlight and annotation markers.
- `prd-annotator/src/index.js` — dataset parsing and view-bundle boot.

### Global Skill scripts

- `prd-annotator-skill/scripts/lib/schema.mjs` — manifest/page/document validation and canonical fingerprints.
- `prd-annotator-skill/scripts/lib/project.mjs` — project-safe paths, walking, exclusions, IDs, atomic text writes.
- `prd-annotator-skill/scripts/lib/html.mjs` — SDK injection parsing, upsert/removal, and relative URL calculation.
- `prd-annotator-skill/scripts/lib/release.mjs` — latest formal Release resolution, asset download, SHA-256 validation.
- `prd-annotator-skill/scripts/lib/documents.mjs` — requirement/PRD inventory and fingerprint refresh.
- `prd-annotator-skill/scripts/lib/view.mjs` — per-page executable view-bundle generation.
- `prd-annotator-skill/scripts/lib/managed-prd.mjs` — deterministic managed page/total PRD rendering.
- `prd-annotator-skill/scripts/discover-project.mjs` — read-only prototype/document discovery CLI.
- `prd-annotator-skill/scripts/install-project.mjs` — consent-gated Release installation and HTML injection CLI.
- `prd-annotator-skill/scripts/refresh-project.mjs` — manifest/document refresh and view regeneration CLI.
- `prd-annotator-skill/scripts/merge-annotations.mjs` — schema-v2 permanent merge using manifest paths.
- `prd-annotator-skill/scripts/check-project.mjs` — complete project gate.
- `prd-annotator-skill/scripts/remove-project.mjs` — consent-gated, snapshot-verified removal of HTML display integration only.
- `prd-annotator-skill/scripts/check-prd.mjs` — compatibility wrapper around the new gate.
- `prd-annotator-skill/scripts/generate-prd.mjs` — explicit managed PRD generation CLI.
- `prd-annotator-skill/scripts/migrate-legacy.mjs` — explicit non-destructive `doc/prd` migration.

### Tests, fixtures, examples, packaging, and docs

- Create focused unit tests under `tests/unit/` for every new module.
- Add `tests/fixtures/install-project/` and update `tests/fixtures/project/` to schema v2.
- Update `tests/e2e/prd-annotator.spec.js` and `examples/device-ops/` to use page view bundles.
- Create `scripts/package-release.mjs` and `scripts/check-repository.mjs`.
- Rewrite `prd-annotator-skill/SKILL.md`, `references/data-schema.md`, `references/prd-workflow.md`, and `agents/openai.yaml`; create `references/installation.md`.
- Update `README.md` and the workspace product guide `../doc/prd-annotator-usage.md`.

---

### Task 1: Schema-v2 Model, Fingerprints, Identity, and Storage Recovery

**Files:**
- Create: `prd-annotator/src/fingerprint.js`
- Modify: `prd-annotator/src/constants.js`
- Modify: `prd-annotator/src/identity.js`
- Modify: `prd-annotator/src/model.js`
- Modify: `prd-annotator/src/storage.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `tests/unit/identity.test.js`
- Modify: `tests/unit/model.test.js`
- Modify: `tests/unit/model-storage.test.js`

**Interfaces:**
- Produces: `canonicalJson(value): string` and `fingerprintValue(value): string` returning `fnv1a32:<8-hex>`.
- Produces: `normalizeAnnotationDocument(value, defaults): AnnotationDocumentV2` and `assertValidDocument(value): AnnotationDocumentV2`.
- Produces: `createEmptyDocument({ projectId, page }): AnnotationDocumentV2`.
- Produces: `createCacheStore({ storage, key, fallbackKeys }).save(record): { persisted, errorName }` and `.getStatus()`.
- Produces: `makeStorageKey(projectId, pageId)` for v2 plus `makeLegacyStorageKeys({ projectId, pageId, scriptSrc, pathname })` for read-only v1 recovery.
- Consumed later by the controller, prompt builder, view validator, Agent scripts, and project gate.

- [ ] **Step 1: Write failing identity, fingerprint, migration, and storage-status tests**

Add tests with these exact assertions:

```js
import { canonicalJson, fingerprintValue } from "../../prd-annotator/src/fingerprint.js";

it("fingerprints objects independently of key insertion order", () => {
  expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  expect(fingerprintValue({ b: 2, a: 1 }))
    .toBe(fingerprintValue({ a: 1, b: 2 }));
});

it("generates an ASCII page id no longer than 32 characters", () => {
  const value = resolvePageId({
    pathname: "/很深/的/页面/路径/index.html"
  });
  expect(value).toMatch(/^index-[a-f0-9]{6}$|^page-[a-f0-9]{6}$/);
  expect(value.length).toBeLessThanOrEqual(32);
});

it("normalizes a v1 annotation into required v2 fields without losing its id", () => {
  const migrated = normalizeAnnotationDocument(v1Document, {
    projectId: "device-demo-a13f92",
    htmlPath: "prototype/index.html"
  });
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.annotations[0]).toMatchObject({
    id: "A001",
    title: v1Document.annotations[0].comment,
    description: v1Document.annotations[0].comment,
    type: "requirement",
    prdContent: v1Document.annotations[0].comment
  });
});

it("reports memory-only mode after localStorage rejects a write", () => {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(() => { throw new DOMException("blocked", "SecurityError"); })
  };
  const cache = createCacheStore({ storage, key: "v2", fallbackKeys: ["v1"] });
  expect(cache.save({ schemaVersion: 2 })).toEqual({
    persisted: false,
    errorName: "SecurityError"
  });
  expect(cache.getStatus()).toEqual({ mode: "memory", errorName: "SecurityError" });
});

it("loads a v1 cache through fallback keys and writes only the v2 key", () => {
  const v1Key = "prd-annotator:v1:device-demo:equipment-ops";
  const v2Key = "prd-annotator:v2:device-demo:equipment-ops";
  const storage = {
    getItem: vi.fn((key) => key === v1Key ? JSON.stringify(v1CacheRecord) : null),
    setItem: vi.fn()
  };
  const cache = createCacheStore({ storage, key: v2Key, fallbackKeys: [v1Key] });
  expect(cache.load()).toEqual(v1CacheRecord);
  cache.save(v2CacheRecord);
  expect(storage.setItem).toHaveBeenCalledWith(v2Key, JSON.stringify(v2CacheRecord));
  expect(storage.setItem).not.toHaveBeenCalledWith(v1Key, expect.any(String));
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/identity.test.js tests/unit/model.test.js tests/unit/model-storage.test.js
```

Expected: FAIL because `fingerprint.js`, schema-v2 normalization, 32-character IDs, fallback keys, and storage status do not exist.

- [ ] **Step 3: Implement canonical fingerprints and schema-v2 normalization**

Use this contract in `fingerprint.js`:

```js
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintValue(value) {
  let hash = 0x811c9dc5;
  for (const character of canonicalJson(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}
```

Set `SDK_VERSION = "2.0.0"`, `SCHEMA_VERSION = 2`, `STORAGE_PREFIX = "prd-annotator:v2"`, and retain `LEGACY_STORAGE_PREFIX = "prd-annotator:v1"`. Define allowed types as `requirement`, `change`, `question`, and `bug`.

The normalized v2 record must have this shape:

```js
{
  schemaVersion: 2,
  projectId: "device-demo-a13f92",
  page: {
    id: "equipment-ops-7c31fa",
    title: "Equipment Operations",
    htmlPath: "prototype/index.html",
    route: "/prototype/index.html"
  },
  annotations: [{
    id: "A001",
    title: "Batch disable",
    description: "Allow operators to disable selected devices.",
    type: "requirement",
    prdContent: "The page shall expose batch disable after one or more rows are selected.",
    acceptanceCriteria: "No device changes until confirmation.",
    dataFields: "deviceIds: string[]",
    apiPath: "POST /api/devices/batch-disable",
    edgeCases: "Reject an empty selection.",
    status: "open",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Equipment list",
      rect: { x: 0, y: 0, width: 100, height: 40 }
    },
    prd: {
      linkedDocuments: [],
      linkedSections: [],
      impactScope: "page",
      summary: ""
    }
  }],
  managedPrd: null
}
```

V1 migration fills `title`, `description`, and `prdContent` from `comment`, sets `type` to `requirement`, adds empty recommended fields and `linkedDocuments`, and preserves all legacy properties needed for recovery.

- [ ] **Step 4: Implement 32-character identity and storage fallback**

Make `resolvePageId` prefer explicit ID and manifest mapping, then return `<slug>-<6-hex>` or `page-<6-hex>`, capped at 32 characters. Keep browser-generated fallback behavior only for pages lacking the injected explicit ID. Retain the current v1 route/project-key derivation as dedicated legacy helpers; do not silently change that algorithm before using it to construct fallback cache keys.

Implement storage status exactly as:

```js
export function createCacheStore({ storage, key, fallbackKeys = [] }) {
  let memoryRecord = null;
  let status = { mode: "storage", errorName: null };
  return Object.freeze({
    load() {
      for (const candidateKey of [key, ...fallbackKeys]) {
        try {
          const raw = storage?.getItem(candidateKey);
          if (raw) return JSON.parse(raw);
        } catch (error) {
          status = { mode: "memory", errorName: error?.name || "StorageError" };
        }
      }
      return memoryRecord ? structuredClone(memoryRecord) : null;
    },
    save(record) {
      memoryRecord = structuredClone(record);
      try {
        storage?.setItem(key, JSON.stringify(record));
        status = { mode: "storage", errorName: null };
        return { persisted: true, errorName: null };
      } catch (error) {
        status = { mode: "memory", errorName: error?.name || "StorageError" };
        return { persisted: false, errorName: status.errorName };
      }
    },
    getStatus: () => ({ ...status })
  });
}
```

Update the controller to normalize cached/hydrated v1 records before merge and to save v2 records under the new key while leaving every v1 key untouched. Build fallback keys for the persisted/injected project and page IDs first, then the legacy route- and script-derived IDs, deduplicate them, and read them only when the v2 key is absent.

- [ ] **Step 5: Run focused and complete unit tests**

Run:

```powershell
npx vitest run tests/unit/identity.test.js tests/unit/model.test.js tests/unit/model-storage.test.js
npm run test:unit
```

Expected: all focused tests PASS and the existing unit suite PASS after its fixtures normalize through the v1 adapter.

- [ ] **Step 6: Commit the schema foundation**

```powershell
git add prd-annotator/src/constants.js prd-annotator/src/fingerprint.js prd-annotator/src/identity.js prd-annotator/src/model.js prd-annotator/src/storage.js prd-annotator/src/runtime/controller.js tests/unit/identity.test.js tests/unit/model.test.js tests/unit/model-storage.test.js
git commit -m "feat: add schema v2 and durable cache status"
```

---

### Task 2: Complete Annotation Editor and Controller Creation Flow

**Files:**
- Modify: `prd-annotator/src/ui/editor.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `tests/unit/annotation-flow.test.js`
- Modify: `tests/unit/model.test.js`

**Interfaces:**
- Consumes: schema-v2 normalization and `AnnotationDocumentV2` from Task 1.
- Produces: `openEditor({ container, target, onSave, onCancel })`, where `onSave(formValue)` receives all required/recommended annotation fields.
- Produces: `createAnnotation(formValue, target, id, timestamp)` inside the controller.

- [ ] **Step 1: Replace the comment-only tests with complete-form failures**

Add a helper and assertions:

```js
function fillRequiredForm(shadow, values = {}) {
  const formValue = {
    title: "Batch disable",
    description: "Add a batch action.",
    type: "requirement",
    prdContent: "Selected devices can be disabled together.",
    acceptanceCriteria: "Confirm before changing state.",
    dataFields: "deviceIds: string[]",
    apiPath: "POST /api/devices/batch-disable",
    edgeCases: "Empty selection is rejected.",
    ...values
  };
  for (const [name, value] of Object.entries(formValue)) {
    shadow.querySelector(`[data-field='${name}']`).value = value;
  }
}

function openAnnotationEditor() {
  const api = createAnnotator({
    window,
    document,
    scriptSrc: "https://example.test/code/prd-annotator.js",
    explicitProjectId: "device-demo-a13f92",
    explicitPageId: "equipment-ops-7c31fa"
  });
  api.mount();
  const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
  shadow.querySelector("[data-action='toggle-annotation']").click();
  document.querySelector("#device-list").dispatchEvent(
    new MouseEvent("click", { bubbles: true })
  );
  return { api, shadow };
}

it("saves every required and recommended annotation field", () => {
  const { api, shadow } = openAnnotationEditor();
  fillRequiredForm(shadow);
  shadow.querySelector("[data-action='save-annotation']").click();
  const saved = api.getSnapshot().document.annotations[0];
  expect(saved).toMatchObject({
    title: "Batch disable",
    description: "Add a batch action.",
    type: "requirement",
    prdContent: "Selected devices can be disabled together.",
    acceptanceCriteria: "Confirm before changing state.",
    dataFields: "deviceIds: string[]",
    apiPath: "POST /api/devices/batch-disable",
    edgeCases: "Empty selection is rejected."
  });
});

it.each(["title", "description", "prdContent"])(
  "blocks save when %s is blank",
  (field) => {
    const { api, shadow } = openAnnotationEditor();
    fillRequiredForm(shadow);
    shadow.querySelector(`[data-field='${field}']`).value = "   ";
    shadow.querySelector("[data-action='save-annotation']").click();
    expect(api.getSnapshot().document.annotations).toHaveLength(0);
    expect(shadow.querySelector(`[data-error-for='${field}']`).hidden).toBe(false);
  }
);

it("keeps a stale target in the Drawer while omitting its marker", () => {
  const { api, shadow } = openAnnotationEditor();
  api.hydrateView({
    schemaVersion: 2,
    generatedAt: "2026-08-09T00:00:00.000Z",
    projectId: "device-demo-a13f92",
    page: api.getSnapshot().document.page,
    persistedAnnotationFingerprint: "fnv1a32:00000000",
    document: {
      ...api.getSnapshot().document,
      annotations: [{
        id: "A999",
        title: "Keep historical requirement",
        description: "The DOM target was removed.",
        type: "requirement",
        prdContent: "Retain this requirement until the replacement target is known.",
        acceptanceCriteria: "",
        dataFields: "",
        apiPath: "",
        edgeCases: "",
        status: "open",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        target: {
          cssPath: "#missing-target",
          xpath: "/html/body/main/article[999]",
          textQuote: "Removed target",
          rect: { x: 0, y: 0, width: 10, height: 10 }
        },
        prd: {
          linkedDocuments: [],
          linkedSections: [],
          impactScope: "page",
          summary: ""
        }
      }]
    },
    documents: []
  });
  shadow.querySelector("[data-action='toggle-drawer']").click();
  expect(shadow.querySelector("[data-role='annotation-list']").textContent)
    .toContain("Keep historical requirement");
  expect(shadow.querySelector("[data-annotation-id='A999']")).toBeNull();
});
```

- [ ] **Step 2: Run the annotation tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/model.test.js
```

Expected: FAIL because only `[data-field='comment']` exists and the controller does not create schema-v2 fields.

- [ ] **Step 3: Implement the complete editor form**

Build controls with these exact dataset names:

```js
const fields = [
  { name: "title", label: "标题", required: true, control: "input" },
  { name: "description", label: "说明", required: true, control: "textarea" },
  { name: "type", label: "类型", required: true, control: "select" },
  { name: "prdContent", label: "PRD 内容", required: true, control: "textarea" },
  { name: "acceptanceCriteria", label: "验收标准", control: "textarea" },
  { name: "dataFields", label: "数据字段", control: "textarea" },
  { name: "apiPath", label: "接口路径", control: "input" },
  { name: "edgeCases", label: "异常与边界", control: "textarea" }
];
```

The type select contains `需求`, `变更`, `问题`, and `缺陷`, with values from `ANNOTATION_TYPES`. On save, trim every string, show one field-specific error for every blank required value, focus the first invalid field, and pass the complete object to `onSave`.

- [ ] **Step 4: Create schema-v2 annotations in the controller and render their details**

Replace `savePendingAnnotation(comment)` with:

```js
function createAnnotation(formValue, target, id, timestamp) {
  return {
    id,
    title: formValue.title,
    description: formValue.description,
    type: formValue.type,
    prdContent: formValue.prdContent,
    acceptanceCriteria: formValue.acceptanceCriteria,
    dataFields: formValue.dataFields,
    apiPath: formValue.apiPath,
    edgeCases: formValue.edgeCases,
    status: "open",
    createdAt: timestamp,
    updatedAt: timestamp,
    target: clone(target),
    prd: {
      linkedDocuments: [],
      linkedSections: [],
      impactScope: "page",
      summary: ""
    }
  };
}

function savePendingAnnotation(formValue) {
  if (!pendingTarget) return;
  const timestamp = now();
  const annotation = createAnnotation(
    formValue,
    pendingTarget,
    nextAnnotationId(),
    timestamp
  );
  documentState = { ...documentState, annotations: [...documentState.annotations, annotation] };
  persistCache();
  closeCurrentEditor();
  renderAll();
}
```

Update annotation cards to show title, type, description, PRD content, and non-empty recommended fields. Do not add edit or delete actions.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/model.test.js tests/unit/prd-drawer.test.js
npm run build
```

Expected: PASS; `prd-annotator/prd-annotator.js` rebuilds without warnings.

- [ ] **Step 6: Commit the complete annotation flow**

```powershell
git add prd-annotator/src/ui/editor.js prd-annotator/src/runtime/controller.js prd-annotator/src/ui/drawer.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js tests/unit/annotation-flow.test.js tests/unit/model.test.js
git commit -m "feat: capture complete prototype annotations"
```

---

### Task 3: Page View Bundles and Multi-document Drawer

**Files:**
- Create: `prd-annotator/src/view-data.js`
- Modify: `prd-annotator/src/index.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `prd-annotator/src/ui/shell.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `tests/unit/prd-drawer.test.js`
- Create: `tests/unit/view-data.test.js`

**Interfaces:**
- Produces: `assertValidViewBundle(value, expected): ViewBundleV2`.
- Produces: `loadViewScript({ document, src }): Promise<void>`.
- Produces: public `window.PRDAnnotator.hydrateView(bundle)` and `reportViewLoadError(error)`; neither API mutates project files or deletes browser data.
- `ViewBundleV2.documents[]` contains `{ id, title, path, format, kind, pageIds, fingerprint, previewStatus, missing, content }`.

- [ ] **Step 1: Write failing view loading and all-document rendering tests**

Use a view fixture containing two page PRDs, one total PRD, one unclassified document, and one missing PDF:

```js
const viewBundle = {
  schemaVersion: 2,
  generatedAt: "2026-08-09T00:00:00.000Z",
  projectId: "device-demo-a13f92",
  page: {
    id: "equipment-ops-7c31fa",
    title: "Equipment Operations",
    htmlPath: "prototype/index.html"
  },
  persistedAnnotationFingerprint: "fnv1a32:741638a5",
  document: createEmptyDocument({
    projectId: "device-demo-a13f92",
    page: {
      id: "equipment-ops-7c31fa",
      title: "Equipment Operations",
      htmlPath: "prototype/index.html",
      route: "/prototype/index.html"
    }
  }),
  documents: [
    { id: "doc-page-a", title: "Page PRD A", path: "doc/page-a.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: `sha256:${"a".repeat(64)}`, previewStatus: "available", missing: false, content: "# Page A" },
    { id: "doc-page-b", title: "Page PRD B", path: "requirements/page-b.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: `sha256:${"b".repeat(64)}`, previewStatus: "available", missing: false, content: "# Page B" },
    { id: "doc-total", title: "Total PRD", path: "PRD.md", format: "markdown", kind: "total-prd", pageIds: [], fingerprint: `sha256:${"c".repeat(64)}`, previewStatus: "available", missing: false, content: "# Product" },
    { id: "doc-other", title: "Open Questions", path: "notes/questions.txt", format: "text", kind: "unclassified", pageIds: [], fingerprint: `sha256:${"d".repeat(64)}`, previewStatus: "available", missing: false, content: "Question one" },
    { id: "doc-pdf", title: "Legacy PDF", path: "legacy/requirements.pdf", format: "pdf", kind: "requirement", pageIds: [], fingerprint: `sha256:${"e".repeat(64)}`, previewStatus: "unavailable", missing: false, content: "" }
  ]
};

it("renders every ambiguous PRD with its source path", () => {
  api.hydrateView(viewBundle);
  const text = shadow.querySelector("[data-role='document-groups']").textContent;
  expect(text).toContain("Page PRD A");
  expect(text).toContain("doc/page-a.md");
  expect(text).toContain("Page PRD B");
  expect(text).toContain("requirements/page-b.md");
});

it("shows an unavailable preview instead of omitting a PDF", () => {
  api.hydrateView(viewBundle);
  expect(shadow.querySelector("[data-document-id='doc-pdf']").textContent)
    .toContain("暂不可预览");
});

it("shows stale and missing-view warnings instead of presenting them as current", () => {
  api.hydrateView({
    ...viewBundle,
    documents: viewBundle.documents.map((item) => item.id === "doc-page-a"
      ? { ...item, previewStatus: "stale" }
      : item)
  });
  expect(shadow.querySelector("[data-document-id='doc-page-a']").textContent)
    .toContain("内容可能已过期");

  api.reportViewLoadError(new Error("view script missing"));
  expect(shadow.querySelector("[data-role='view-warning']").textContent)
    .toContain("需要 AI Agent 重新生成本页展示数据");
  expect(api.getSnapshot().document.annotations)
    .toEqual(viewBundle.document.annotations);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx vitest run tests/unit/view-data.test.js tests/unit/prd-drawer.test.js
```

Expected: FAIL because view bundles, document groups, and `hydrateView` do not exist.

- [ ] **Step 3: Implement view validation and local script loading**

Validate schema, project/page identity, persisted fingerprint, the annotation document, unique document IDs, relative document paths, and preview states `available`, `unavailable`, `missing`, or `stale`.

Implement script loading without `fetch`:

```js
export function loadViewScript({ document, src }) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.dataset.prdAnnotatorViewLoader = "true";
    script.addEventListener("load", () => { script.remove(); resolve(); }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error(`Unable to load PRD Annotator view: ${src}`));
    }, { once: true });
    document.head.append(script);
  });
}
```

Update `index.js` to read `data-view-src`, set `window.PRDAnnotator`, mount, then call `loadViewScript`. A generated view file calls `window.PRDAnnotator.hydrateView(<bundle>)`. The loader rejection path calls `reportViewLoadError(error)` so the Drawer warns without losing cached annotations.

- [ ] **Step 4: Implement grouped Drawer rendering**

Add shell containers for page metadata, sync state, annotation list, document groups, sync help, and `[data-role='view-warning']`. Render documents in the required order: direct page, project/total/public, then other/unclassified. Each document card must show title, source path, display kind, preview state, and sanitized full content. Reuse `renderMarkdown`; never assign source content to `innerHTML`. Render explicit warnings for a missing bundle and every document whose preview state is `stale` or `missing`.

Controller hydration must merge annotations monotonically, replace the current view document inventory, store the persisted fingerprint, and cache without dropping browser-only annotations.

- [ ] **Step 5: Run unit tests, lifecycle tests, and build**

```powershell
npx vitest run tests/unit/view-data.test.js tests/unit/prd-drawer.test.js tests/unit/lifecycle.test.js
npm run build
```

Expected: PASS; the lifecycle test still finds exactly two `[data-role='tool-button']` nodes.

- [ ] **Step 6: Commit view-bundle support**

```powershell
git add prd-annotator/src/view-data.js prd-annotator/src/index.js prd-annotator/src/runtime/controller.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/drawer.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js tests/unit/view-data.test.js tests/unit/prd-drawer.test.js
git commit -m "feat: display project document inventories"
```

---

### Task 4: Universal Sync Prompt, Sync Fingerprints, and Clipboard Guidance

**Files:**
- Create: `prd-annotator/src/sync-prompt.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Modify: `prd-annotator/src/ui/shell.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Create: `tests/unit/sync-prompt.test.js`
- Create: `tests/unit/sync-status.test.js`

**Interfaces:**
- Produces: `buildSyncPrompt(context): string`.
- Produces: `computeSyncState({ currentFingerprint, persistedFingerprint, cacheStatus }): "synced" | "browser-only" | "memory-only"`.
- Extends `getSnapshot()` with `annotationFingerprint`, computed from the current annotation array only.
- Produces: public `getSyncPrompt(): string`; copy button uses `navigator.clipboard.writeText` but never changes persisted status.

- [ ] **Step 1: Write failing prompt and status tests**

Require stable payload markers and an explicit no-PRD-edit instruction:

```js
it("copies a complete Agent-independent synchronization payload", () => {
  const prompt = buildSyncPrompt(context);
  expect(prompt).toContain("请将以下 PRD Annotator 本页标注同步到当前项目文件");
  expect(prompt).toContain("复制提示词不代表同步成功");
  expect(prompt).toContain("本次只同步标注并重新生成 view，不修改任何 PRD");
  expect(prompt).toContain("---PRD_ANNOTATOR_PAYLOAD_START---");
  expect(prompt).toContain('"pageId":"equipment-ops-7c31fa"');
  expect(prompt).toContain('"annotations"');
  expect(prompt).toContain("---PRD_ANNOTATOR_PAYLOAD_END---");
});

it("does not report copied data as synchronized", async () => {
  await shadow.querySelector("[data-action='copy-sync-prompt']").click();
  expect(clipboard.writeText).toHaveBeenCalledOnce();
  expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
    .toBe("browser-only");
  expect(shadow.querySelector("[data-role='copy-result']").textContent)
    .toContain("请返回 AI Agent 粘贴并发送");
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx vitest run tests/unit/sync-prompt.test.js tests/unit/sync-status.test.js
```

Expected: FAIL because prompt generation, sync-state computation, and copy UI do not exist.

- [ ] **Step 3: Implement the deterministic prompt and payload**

`context` contains:

```js
{
  projectId,
  pageId,
  htmlPath,
  manifestPath: ".prd-annotator/manifest.json",
  annotationPath: `.prd-annotator/data/pages/${pageId}.json`,
  viewPath: `.prd-annotator/view/pages/${pageId}.js`,
  fingerprint: fingerprintValue(document.annotations),
  document
}
```

The prompt must instruct the Agent to validate required fields, merge by ID and `updatedAt`, preserve permanent-only IDs, write the annotation JSON, regenerate the view, run the project gate, report changed files, and avoid PRD edits. Serialize the payload with `canonicalJson` between the exact markers used in the tests.

- [ ] **Step 4: Implement Drawer state and copy flow**

Compute the current fingerprint from annotations only. Compare it to the persisted view fingerprint. Render:

- `synced`: `已同步到项目`.
- `browser-only`: `当前标注仅保存在此浏览器，尚未同步到项目`.
- `memory-only`: `浏览器存储不可用。关闭页面前必须复制提示词并让 AI 同步`.

The Drawer must always render the numbered instructions `复制`, `返回 AI Agent`, `粘贴并发送`, and `等待文件写入报告`. Clipboard failure shows a selectable readonly textarea containing the same prompt; it does not discard the in-memory payload.

- [ ] **Step 5: Run tests and build**

```powershell
npx vitest run tests/unit/sync-prompt.test.js tests/unit/sync-status.test.js tests/unit/annotation-flow.test.js
npm run build
```

Expected: PASS; generated SDK contains `PRD_ANNOTATOR_PAYLOAD_START` and no delete/reset API.

- [ ] **Step 6: Commit the universal synchronization UX**

```powershell
git add prd-annotator/src/sync-prompt.js prd-annotator/src/runtime/controller.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/drawer.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js tests/unit/sync-prompt.test.js tests/unit/sync-status.test.js
git commit -m "feat: add universal annotation sync prompt"
```

---

### Task 5: Example View Data and Browser End-to-end Contract

**Files:**
- Create: `examples/device-ops/equipment-ops-view.js`
- Create: `examples/device-ops/maintenance-records-view.js`
- Modify: `examples/device-ops/index.html`
- Modify: `examples/device-ops/second-page.html`
- Delete: `examples/device-ops/sample-data.js`
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `tests/fixtures/static-server.mjs`

**Interfaces:**
- Consumes: schema-v2 SDK, `data-view-src`, `hydrateView`, sync prompt, and view bundle from Tasks 1–4.
- Produces: executable examples for both `file://` and HTTP validation.

- [ ] **Step 1: Update E2E expectations before changing fixtures**

Add these imports and scenarios:

```js
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("shows exactly two tools, all documents, and a synchronized empty state", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);
  await host.locator("[data-action='toggle-drawer']").click();
  await expect(host.locator("[data-document-id='doc-page-primary']"))
    .toContainText("设备运维页面 PRD");
  await expect(host.locator("[data-document-id='doc-page-alternate']"))
    .toContainText("备选页面 PRD");
  await expect(host.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "synced");
});

test("copies the full prompt and becomes synced only after a matching view refresh", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => { window.__copiedSyncPrompt = value; }
      }
    });
  });
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await host.locator("[data-action='toggle-annotation']").click();
  await page.locator("[data-demo='device-table']").click();
  await host.locator("[data-field='title']").fill("批量停用");
  await host.locator("[data-field='description']").fill("增加批量停用入口");
  await host.locator("[data-field='type']").selectOption("requirement");
  await host.locator("[data-field='prdContent']").fill("选中设备后可以批量停用");
  await host.locator("[data-field='acceptanceCriteria']").fill("提交前二次确认");
  await host.locator("[data-action='save-annotation']").click();
  await host.locator("[data-action='toggle-drawer']").click();

  await expect(host.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "browser-only");
  await host.locator("[data-action='copy-sync-prompt']").click();
  const copiedPrompt = await page.evaluate(() => window.__copiedSyncPrompt);
  expect(copiedPrompt).toContain("---PRD_ANNOTATOR_PAYLOAD_START---");
  expect(copiedPrompt).toContain('"pageId":"equipment-ops-7c31fa"');
  await expect(host.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "browser-only");

  await page.evaluate(() => {
    const snapshot = window.PRDAnnotator.getSnapshot();
    window.PRDAnnotator.hydrateView({
      schemaVersion: 2,
      generatedAt: "2026-08-09T00:05:00.000Z",
      projectId: snapshot.document.projectId,
      page: snapshot.document.page,
      persistedAnnotationFingerprint: snapshot.annotationFingerprint,
      document: snapshot.document,
      documents: []
    });
  });
  await expect(host.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "synced");
});

test("boots the same SDK and view bundle from a local file URL", async ({ page }) => {
  const fileUrl = pathToFileURL(
    path.join(repositoryRoot, "examples/device-ops/index.html")
  ).href;
  await page.goto(fileUrl);
  const loaded = await page.evaluate(() => Boolean(window.PRDAnnotator));
  test.skip(!loaded, "Chromium disabled local sibling-script loading");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);
  await host.locator("[data-action='toggle-drawer']").click();
  await expect(host.locator("[data-document-id='doc-page-primary']"))
    .toContainText("设备运维页面 PRD");
});
```

The HTTP tests remain mandatory; only the `file://` case may be skipped by the runtime capability check shown above.

- [ ] **Step 2: Run E2E and verify fixture failures**

```powershell
npm run build
npx playwright test tests/e2e/prd-annotator.spec.js
```

Expected: FAIL because the example has legacy `sample-data.js`, no `data-view-src`, and the editor is comment-only in the current fixture.

- [ ] **Step 3: Replace sample hydration with generated-style page bundles**

`equipment-ops-view.js` must contain this complete empty-persisted-state bundle; later E2E annotations live in browser cache until the simulated matching hydration:

```js
window.PRDAnnotator.hydrateView({
  schemaVersion: 2,
  generatedAt: "2026-08-09T00:00:00.000Z",
  projectId: "device-demo-a13f92",
  page: {
    id: "equipment-ops-7c31fa",
    title: "设备运维台",
    htmlPath: "examples/device-ops/index.html"
  },
  persistedAnnotationFingerprint: "fnv1a32:741638a5",
  document: {
    schemaVersion: 2,
    projectId: "device-demo-a13f92",
    page: {
      id: "equipment-ops-7c31fa",
      title: "设备运维台",
      htmlPath: "examples/device-ops/index.html",
      route: "/examples/device-ops/index.html"
    },
    annotations: [],
    managedPrd: null
  },
  documents: [
    { id: "doc-page-primary", title: "设备运维页面 PRD", path: "doc/prd/pages/equipment-ops.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", previewStatus: "available", missing: false, content: "# 设备运维页面 PRD\n\n主页面需求。" },
    { id: "doc-page-alternate", title: "备选页面 PRD", path: "requirements/equipment-ops-alternate.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", previewStatus: "available", missing: false, content: "# 备选页面 PRD\n\n保留给用户自行判断。" },
    { id: "doc-total", title: "产品总 PRD", path: "doc/prd/PRD.md", format: "markdown", kind: "total-prd", pageIds: [], fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", previewStatus: "available", missing: false, content: "# 产品总 PRD\n\n设备运维原型。" },
    { id: "doc-legacy-pdf", title: "历史需求 PDF", path: "legacy/device-requirements.pdf", format: "pdf", kind: "requirement", pageIds: [], fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", previewStatus: "unavailable", missing: false, content: "" }
  ]
});
```

`maintenance-records-view.js` uses the same literal schema with these exact identity values: project `device-demo-a13f92`, page `maintenance-records-4d92b1`, HTML `examples/device-ops/second-page.html`, route `/examples/device-ops/second-page.html`, empty annotations, fingerprint `fnv1a32:741638a5`, and two documents: `doc-maintenance` at `doc/prd/pages/maintenance-records.md` with kind `page-prd`, plus the same `doc-total` entry. Do not import or fetch runtime data. Delete `sample-data.js` only after both HTML files use one SDK script with `data-project-id`, `data-page-id`, and `data-view-src`.

- [ ] **Step 4: Run E2E, unit tests, and build**

```powershell
npm run test:unit
npm run build
npx playwright test tests/e2e/prd-annotator.spec.js
```

Expected: unit tests PASS, build PASS, and all E2E cases PASS with exactly two floating buttons.

- [ ] **Step 5: Commit browser integration**

```powershell
git add examples/device-ops/index.html examples/device-ops/second-page.html examples/device-ops/equipment-ops-view.js examples/device-ops/maintenance-records-view.js tests/e2e/prd-annotator.spec.js tests/fixtures/static-server.mjs prd-annotator/prd-annotator.js
git add -u examples/device-ops/sample-data.js
git commit -m "test: cover static view and sync workflow"
```

---

### Task 6: Project Contract and Read-only Discovery

**Files:**
- Create: `prd-annotator-skill/scripts/lib/schema.mjs`
- Create: `prd-annotator-skill/scripts/lib/project.mjs`
- Create: `prd-annotator-skill/scripts/discover-project.mjs`
- Create: `tests/fixtures/install-project/prototype/index.html`
- Create: `tests/fixtures/install-project/prototype/deep/details.html`
- Create: `tests/fixtures/install-project/src/app.html`
- Create: `tests/fixtures/install-project/dist/generated.html`
- Create: `tests/fixtures/install-project/docs/PRD.md`
- Create: `tests/fixtures/install-project/requirements/equipment.md`
- Create: `tests/unit/project-discovery.test.js`

**Interfaces:**
- Produces: `assertInsideProject(root, candidate, label)`.
- Produces: `toProjectPath(root, absolutePath)` using forward slashes.
- Produces: `walkProject(root, { extensions, excludedDirectories })`.
- Produces: `deriveProjectId(rootName, normalizedProjectRoot)` and `derivePageId(relativeHtmlPath, usedIds)`.
- Produces from `lib/schema.mjs`: `canonicalJson(value)`, `fingerprintValue(value)`, `createEmptyAnnotationDocument({ projectId, page })`, `normalizeAnnotationDocument(value, defaults)`, `validateAnnotationDocument(value)`, and `validateManifestV2(manifest)`; fingerprint and normalized field names must match the browser implementation byte-for-byte.
- Produces: `discoverProject({ projectRoot }): DiscoveryReport`; the CLI prints this JSON and writes nothing.

- [ ] **Step 1: Write failing read-only discovery tests**

```js
it("finds source prototypes and excludes build output", async () => {
  const report = await discoverProject({ projectRoot: fixtureRoot });
  expect(report.htmlCandidates.map((page) => page.htmlPath)).toEqual([
    "prototype/deep/details.html",
    "prototype/index.html",
    "src/app.html"
  ]);
  expect(report.htmlCandidates.every((page) => /^[a-z0-9-]{1,32}$/.test(page.suggestedPageId)))
    .toBe(true);
  expect(report.scopeAmbiguous).toBe(true);
  expect(report.ambiguityReasons).toContain(
    "HTML exists in both prototype-like and application-source locations"
  );
  expect(report.htmlCandidates.map((page) => page.htmlPath))
    .not.toContain("dist/generated.html");
});

it("derives a short ASCII id for a non-ASCII source filename", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "prd-discovery-"));
  temporaryDirectories.push(temporaryRoot);
  await cp(fixtureRoot, temporaryRoot, { recursive: true });
  const chinesePath = path.join(temporaryRoot, "prototype/deep/详情.html");
  await writeFile(chinesePath, "<!doctype html><title>详情</title>", "utf8");
  const report = await discoverProject({ projectRoot: temporaryRoot });
  const candidate = report.htmlCandidates.find(
    (page) => page.htmlPath === "prototype/deep/详情.html"
  );
  expect(candidate.suggestedPageId).toMatch(/^deep-[a-f0-9]{6}$/);
  expect(candidate.suggestedPageId.length).toBeLessThanOrEqual(32);
});

it("is read-only", async () => {
  const before = await snapshotFiles(fixtureRoot);
  await discoverProject({ projectRoot: fixtureRoot });
  expect(await snapshotFiles(fixtureRoot)).toEqual(before);
  expect(existsSync(path.join(fixtureRoot, ".prd-annotator"))).toBe(false);
});
```

Validate the CLI output with `execFileSync(process.execPath, [discoverScript, "--project-root", fixtureRoot])`.

- [ ] **Step 2: Run discovery tests and verify failure**

```powershell
npx vitest run tests/unit/project-discovery.test.js
```

Expected: FAIL because the Skill has no project library or discovery CLI.

- [ ] **Step 3: Implement path-safe walking and identity helpers**

Use `fs/promises.readdir({ withFileTypes: true })`, sort entries before recursion, never follow symlinks, and skip the exact excluded directory set from Global Constraints. Reject any normalized path whose `path.relative` begins with `..` or is absolute.

Derive page IDs from an ASCII-cleaned file stem; if the stem is unusable, try the nearest parent; otherwise use `page`. Append six FNV hex characters from the normalized project-relative path, avoid collisions, and cap at 32. Derive the project ID as `<ASCII-root-slug>-<6-hex-of-normalized-root>` and cap it at 32; after installation the persisted manifest value always wins.

Classify HTML location evidence as `prototype-like`, `application-like`, or `unknown` for reporting only. If both prototype-like and application-like locations exist, or only unknown locations exist, set `scopeAmbiguous: true` and include a concrete `ambiguityReasons` entry. Discovery never chooses pages or writes integrations; the Skill must show this report and obtain page scope before calling the installer.

- [ ] **Step 4: Implement the schema-v2 manifest validator and discovery report**

Use this manifest contract:

```js
{
  schemaVersion: 2,
  project: {
    id: "device-demo-a13f92",
    sdk: {
      version: "2.0.0",
      releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
      sha256: "<64 lowercase hex>",
      installedAt: "2026-08-09T00:00:00.000Z"
    }
  },
  pages: [{
    id: "equipment-ops-7c31fa",
    title: "Equipment Operations",
    htmlPath: "prototype/index.html",
    annotationFile: ".prd-annotator/data/pages/equipment-ops-7c31fa.json",
    viewFile: ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
    display: {
      enabled: true,
      updatedAt: "2026-08-09T00:00:00.000Z"
    }
  }],
  documents: [],
  migration: null
}
```

`discover-project.mjs` accepts only `--project-root PATH`, prints the report, and performs no writes.

Add a parity assertion importing browser and Skill fingerprints:

```js
expect(skillFingerprintValue([{ title: "设备", id: "A001" }]))
  .toBe(browserFingerprintValue([{ id: "A001", title: "设备" }]));
expect(skillNormalizeAnnotationDocument(v1Document, defaults))
  .toEqual(browserNormalizeAnnotationDocument(v1Document, defaults));
```

- [ ] **Step 5: Run tests and commit discovery**

```powershell
npx vitest run tests/unit/project-discovery.test.js
git add prd-annotator-skill/scripts/lib/schema.mjs prd-annotator-skill/scripts/lib/project.mjs prd-annotator-skill/scripts/discover-project.mjs tests/fixtures/install-project tests/unit/project-discovery.test.js
git commit -m "feat: add read-only prototype discovery"
```

---

### Task 7: Consent-gated Release Installer and HTML Path Gate

**Files:**
- Create: `prd-annotator-skill/scripts/lib/html.mjs`
- Create: `prd-annotator-skill/scripts/lib/release.mjs`
- Create: `prd-annotator-skill/scripts/install-project.mjs`
- Create: `tests/unit/html-injection.test.js`
- Create: `tests/unit/project-install.test.js`

**Interfaces:**
- Produces: `relativeWebPath(fromHtmlPath, targetPath): string`.
- Produces: `inspectIntegration(html): IntegrationRecord[]`.
- Produces: `upsertIntegration(html, attrs): string` and `removeIntegration(html): string`.
- Produces: `resolveLatestRelease({ fetchImpl, repository }): ReleaseInfo`, where `ReleaseInfo` is `{ version, releaseUrl, sdkBuffer, sha256 }`.
- Produces: `installProject({ projectRoot, pagePaths, confirmInstall, confirmUpgrade, releaseClient, now }): ManifestV2`.

- [ ] **Step 1: Write failing consent, Release, nested-path, and non-overwrite tests**

```js
const sdkBuffer = Buffer.from("/* PRD Annotator v2.0.0 */", "utf8");
const releaseInfo = {
  version: "2.0.0",
  releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.0.0",
  sdkBuffer,
  sha256: createHash("sha256").update(sdkBuffer).digest("hex")
};
const releaseClient = {
  getLatestRelease: vi.fn(async () => releaseInfo)
};

it("refuses to mutate without explicit installation confirmation", async () => {
  await expect(installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: false,
    releaseClient
  })).rejects.toThrow("--confirm-install is required");
  expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
});

it("leaves HTML untouched when Release resolution or checksum validation fails", async () => {
  const htmlPath = path.join(projectRoot, "prototype/index.html");
  const htmlBefore = readFileSync(htmlPath, "utf8");
  const failingReleaseClient = {
    getLatestRelease: vi.fn(async () => {
      throw new Error("Downloaded SDK SHA-256 does not match the Release checksum");
    })
  };
  await expect(installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    releaseClient: failingReleaseClient
  })).rejects.toThrow("Downloaded SDK SHA-256 does not match the Release checksum");
  expect(readFileSync(htmlPath, "utf8")).toBe(htmlBefore);
  expect(existsSync(path.join(projectRoot, ".prd-annotator"))).toBe(false);
});

it("injects one valid relative SDK reference per explicit page", async () => {
  const manifest = await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html", "prototype/deep/details.html"],
    confirmInstall: true,
    releaseClient
  });
  for (const pageEntry of manifest.pages) {
    const html = readFileSync(path.join(projectRoot, pageEntry.htmlPath), "utf8");
    const [integration] = inspectIntegration(html);
    expect(inspectIntegration(html)).toHaveLength(1);
    expect(resolveFromHtml(pageEntry.htmlPath, integration.src))
      .toBe(".prd-annotator/sdk/prd-annotator.js");
    expect(resolveFromHtml(pageEntry.htmlPath, integration.viewSrc))
      .toBe(pageEntry.viewFile);
  }
});

it("reuses an installed SDK without checking or applying a newer Release", async () => {
  await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    releaseClient
  });
  const sdkPath = path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js");
  const installedBytes = readFileSync(sdkPath);
  releaseClient.getLatestRelease.mockClear();

  const manifest = await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html", "prototype/deep/details.html"],
    confirmInstall: true,
    confirmUpgrade: false,
    releaseClient
  });

  expect(releaseClient.getLatestRelease).not.toHaveBeenCalled();
  expect(readFileSync(sdkPath)).toEqual(installedBytes);
  expect(manifest.project.sdk.version).toBe("2.0.0");
});

it("replaces SDK bytes only with explicit upgrade authorization", async () => {
  await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    releaseClient
  });
  const upgradedBuffer = Buffer.from("/* PRD Annotator v2.1.0 */", "utf8");
  const upgradeClient = {
    getLatestRelease: vi.fn(async () => ({
      version: "2.1.0",
      releaseUrl: "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v2.1.0",
      sdkBuffer: upgradedBuffer,
      sha256: createHash("sha256").update(upgradedBuffer).digest("hex")
    }))
  };
  const manifest = await installProject({
    projectRoot,
    pagePaths: ["prototype/index.html"],
    confirmInstall: true,
    confirmUpgrade: true,
    releaseClient: upgradeClient
  });
  expect(readFileSync(path.join(
    projectRoot,
    ".prd-annotator/sdk/prd-annotator.js"
  ))).toEqual(upgradedBuffer);
  expect(manifest.project.sdk.version).toBe("2.1.0");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx vitest run tests/unit/html-injection.test.js tests/unit/project-install.test.js
```

Expected: FAIL because release and installation modules do not exist.

- [ ] **Step 3: Implement HTML inspection and relative URL calculation**

`upsertIntegration` must:

- Reject more than one existing PRD Annotator script.
- Update a single existing integration without adding a duplicate.
- Otherwise insert one single-line script immediately before `</body>`.
- Escape attribute values.
- Write `src`, `data-project-id`, `data-page-id`, and `data-view-src`.
- Use forward slashes and no absolute/file/HTTP URL.

`removeIntegration` removes only that script tag and leaves every other script intact.

- [ ] **Step 4: Implement formal Release resolution and SHA-256 verification**

Use GitHub's latest Release API and require assets named `prd-annotator.js` and `prd-annotator.js.sha256`. Parse the checksum as exactly 64 lowercase hex characters and verify:

```js
export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

if (sha256(sdkBuffer) !== expectedSha256) {
  throw new Error("Downloaded SDK SHA-256 does not match the Release checksum");
}
```

Tests inject a fake `fetchImpl`; no test contacts GitHub.

- [ ] **Step 5: Implement the installer CLI and post-write gate**

CLI syntax:

```text
node install-project.mjs --project-root PATH --confirm-install --page prototype/index.html --page prototype/deep/details.html
node install-project.mjs --project-root PATH --confirm-install --confirm-upgrade --page prototype/index.html
```

Require at least one repeated `--page`. Verify each page is a discovered source HTML inside the project and not excluded. If discovery reports ambiguous scope, every page must come from the user's explicit selection recorded by the Skill; the CLI never expands the list. Download and validate before any first-install write. Prepare all HTML strings and manifest entries in memory, validate their resolved paths, then write SDK, empty page JSON, empty view bundle, manifest, and HTML. Report the installed version and every changed path.

On existing installations, preserve manifest page IDs first and valid injected `data-page-id` values second. Reuse the installed SDK without calling GitHub unless `--confirm-upgrade` is present. Add a test that moves an already injected HTML file, supplies its new project-relative path, and verifies its explicit `data-page-id` and annotation filename remain unchanged.

If `.prd-annotator/manifest.json` exists but is invalid or corrupt, stop before changing any file and report the validation failure. Never reconstruct over the original manifest by guessing.

- [ ] **Step 6: Run installer tests and commit**

```powershell
npx vitest run tests/unit/html-injection.test.js tests/unit/project-install.test.js
git add prd-annotator-skill/scripts/lib/html.mjs prd-annotator-skill/scripts/lib/release.mjs prd-annotator-skill/scripts/install-project.mjs tests/unit/html-injection.test.js tests/unit/project-install.test.js
git commit -m "feat: install release-pinned SDK with consent"
```

---

### Task 8: Document Inventory, Fingerprints, and View Regeneration

**Files:**
- Create: `prd-annotator-skill/scripts/lib/documents.mjs`
- Create: `prd-annotator-skill/scripts/lib/view.mjs`
- Create: `prd-annotator-skill/scripts/refresh-project.mjs`
- Create: `tests/unit/document-discovery.test.js`
- Create: `tests/unit/view-builder.test.js`

**Interfaces:**
- Produces: `discoverDocuments({ projectRoot, existingDocuments }): DocumentEntry[]`.
- Produces: `buildViewBundle({ manifest, page, annotationDocument, documents, previews, generatedAt }): ViewBundleV2`.
- Produces: `serializeViewBundle(bundle): string`, exactly `window.PRDAnnotator.hydrateView(<canonical-json>);\n`.
- Produces: `refreshProject({ projectRoot, previewMap, now }): ManifestV2`.

- [ ] **Step 1: Write failing inventory and view tests**

```js
it("keeps all ambiguous PRDs and preserves manual mappings", async () => {
  const existingDocuments = [{
    id: "doc-manual",
    path: "requirements/equipment.md",
    title: "Equipment rules",
    format: "markdown",
    kind: "page-prd",
    pageIds: ["equipment-ops-7c31fa"],
    associationSource: "manual"
  }];
  const documents = await discoverDocuments({ projectRoot, existingDocuments });
  expect(documents.filter((item) => item.kind === "total-prd").length)
    .toBeGreaterThanOrEqual(1);
  expect(documents.find((item) => item.id === "doc-manual").pageIds)
    .toEqual(["equipment-ops-7c31fa"]);
});

it("marks a missing source instead of deleting its manifest entry", async () => {
  const documents = await discoverDocuments({ projectRoot, existingDocuments: [missingEntry] });
  expect(documents).toContainEqual(expect.objectContaining({
    id: missingEntry.id,
    missing: true,
    previewStatus: "missing"
  }));
});

it("serializes a static executable view without fetch", () => {
  const source = serializeViewBundle(bundle);
  expect(source.startsWith("window.PRDAnnotator.hydrateView(")).toBe(true);
  expect(source).not.toContain("fetch(");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx vitest run tests/unit/document-discovery.test.js tests/unit/view-builder.test.js
```

Expected: FAIL because document and view libraries do not exist.

- [ ] **Step 3: Implement deterministic document discovery**

First-class text extensions are `.md`, `.markdown`, `.txt`, `.json`, `.yaml`, and `.yml`. Binary asset extensions are `.pdf` and `.docx`. Skip project exclusions and SDK/generated view paths. Use filename/content evidence to suggest `page-prd`, `total-prd`, `requirement`, `other`, or `unclassified`; store the evidence but never assign priority.

IDs use `doc-<10-hex-of-project-relative-path>`. SHA-256 fingerprints use file bytes. Existing manual `kind` and `pageIds` always win. Missing existing entries remain with `missing: true`.

- [ ] **Step 4: Implement full view generation and optional extracted previews**

Markdown/TXT content is copied as text; JSON/YAML is normalized for display without executing code. PDF/DOCX default to empty content and `unavailable`. `refresh-project.mjs` accepts optional `--preview-map PATH`, where the JSON maps project-relative source paths to extracted plain text; those entries become `available` in the generated view without modifying the source document.

For each manifest page, include every direct page document, every total/public document, and every unclassified candidate. Preserve source path and content fingerprint. Set `persistedAnnotationFingerprint = fingerprintValue(annotationDocument.annotations)`.

- [ ] **Step 5: Implement refresh CLI and test actual writes**

CLI:

```text
node refresh-project.mjs --project-root PATH
node refresh-project.mjs --project-root PATH --preview-map TEMP_JSON
```

It reads the existing authorized manifest, refreshes documents, marks missing entries, writes the manifest, and regenerates all page view files. It never edits source PRDs.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/unit/document-discovery.test.js tests/unit/view-builder.test.js
git add prd-annotator-skill/scripts/lib/documents.mjs prd-annotator-skill/scripts/lib/view.mjs prd-annotator-skill/scripts/refresh-project.mjs tests/unit/document-discovery.test.js tests/unit/view-builder.test.js
git commit -m "feat: inventory documents and build page views"
```

---

### Task 9: Permanent Annotation Merge and Complete Project Gate

**Files:**
- Modify: `prd-annotator-skill/scripts/merge-annotations.mjs`
- Create: `prd-annotator-skill/scripts/check-project.mjs`
- Modify: `prd-annotator-skill/scripts/check-prd.mjs`
- Modify: `tests/unit/skill-scripts.test.js`
- Create: `tests/unit/project-gate.test.js`
- Replace fixture layout under: `tests/fixtures/project/.prd-annotator/`
- Preserve fixture source documents under: `tests/fixtures/project/doc/prd/`

**Interfaces:**
- Consumes: schema/path/document/view helpers from Tasks 6–8.
- Produces: `mergeSnapshot({ projectRoot, snapshot }): AnnotationDocumentV2`.
- Produces: `checkProject({ projectRoot }): { pages, annotations, documents }`.
- `check-prd.mjs` delegates to `check-project.mjs` for compatibility.

- [ ] **Step 1: Rewrite fixture expectations and add failing gates**

The fixture manifest moves to `.prd-annotator/manifest.json`; annotation JSON moves to `.prd-annotator/data/pages/equipment-ops-7c31fa.json`; PRDs stay under `doc/prd/` and are inventoried.

Add failures for:

```js
it("rejects an annotation missing PRD content", () => {
  permanent.annotations[0].prdContent = "";
  writeJson(annotationPath, permanent);
  expectCheckFailure(projectRoot, "annotation A001.prdContent must be a non-empty string");
});

it("rejects an HTML view path that resolves outside the project", () => {
  replaceHtmlAttribute(htmlPath, "data-view-src", "../../../../outside.js");
  expectCheckFailure(projectRoot, "data-view-src resolves outside project root");
});

it("rejects stale view document fingerprints", () => {
  appendFileSync(sourcePrdPath, "\nchanged\n");
  expectCheckFailure(projectRoot, "view fingerprint is stale for doc-page-primary");
});

it("merges an empty snapshot without reducing permanent ids", () => {
  runMerge(emptySnapshot);
  expect(readJson(annotationPath).annotations.map((item) => item.id))
    .toEqual(["A001"]);
});
```

- [ ] **Step 2: Run gate tests and verify failure**

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/project-gate.test.js
```

Expected: FAIL because scripts still assume `doc/prd/manifest.json` and schema v1.

- [ ] **Step 3: Rewrite permanent merge around the manifest**

Resolve the target page from the incoming `projectId` and `page.id`. Read `page.annotationFile` from the manifest, assert it remains inside the project, normalize v1 input if needed, validate required v2 fields, merge by ID and `updatedAt`, compare the before/after ID sets, and write only when no ID is lost.

Accept a raw snapshot JSON or the JSON object extracted from the universal prompt. Do not parse arbitrary prose in the script; the Skill instructs the Agent to save the delimited payload as a temporary JSON file.

- [ ] **Step 4: Implement the full project gate**

Check:

- Manifest schema and unique project/page/document IDs.
- SDK file SHA-256 and recorded version.
- Page ID ASCII/length.
- Exactly one SDK integration when `page.display.enabled` is true, and zero when it is false.
- Local project-contained `src` and `data-view-src`.
- Annotation/view file existence and project containment.
- Required annotation fields, allowed types/status/scopes, unique IDs, target recovery fields, valid dates.
- View page/project identity, persisted annotation fingerprint, source document fingerprint/status.
- Every discovered related document represented once.
- Missing documents explicitly marked missing.
- Managed PRD checks when managed paths exist.

Success output is exactly:

```text
PRD Annotator gate passed: <pages> pages, <annotations> annotations, <documents> documents
```

Make `check-prd.mjs` import and call the new gate rather than maintaining a second implementation.

- [ ] **Step 5: Run tests and prohibited-operation scan**

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/project-gate.test.js
rg -n "\b(rm|unlink|rmdir|removeItem|clearAll|resetData|purge)\b" prd-annotator-skill prd-annotator/src
```

Expected: tests PASS; `rg` returns no destructive data workflow matches. A method named `removeIntegration` is allowed only in the installer HTML helper and must remove the script tag, never data.

- [ ] **Step 6: Commit merge and gates**

```powershell
git add prd-annotator-skill/scripts/merge-annotations.mjs prd-annotator-skill/scripts/check-project.mjs prd-annotator-skill/scripts/check-prd.mjs tests/unit/skill-scripts.test.js tests/unit/project-gate.test.js tests/fixtures/project
git commit -m "feat: enforce project-wide annotation gates"
```

---

### Task 10: Snapshot-verified Safe Display-layer Removal

**Files:**
- Create: `prd-annotator-skill/scripts/remove-project.mjs`
- Modify: `prd-annotator-skill/scripts/lib/html.mjs`
- Modify: `prd-annotator-skill/scripts/merge-annotations.mjs`
- Modify: `prd-annotator-skill/scripts/check-project.mjs`
- Create: `tests/unit/project-removal.test.js`
- Modify: `tests/unit/lifecycle.test.js`

**Interfaces:**
- Consumes: `mergeSnapshot`, `refreshProject`, `checkProject`, `inspectIntegration`, and `removeIntegration` from Tasks 7–9.
- Produces: `removeProject({ projectRoot, pageIds, snapshots, confirmRemove, now }): { removedPages, changedFiles }`.
- A removal snapshot is either a direct `getSnapshot()` object or the exact payload object extracted from the copied prompt; its embedded project/page identity determines which page it can authorize.

- [ ] **Step 1: Write failing consent, snapshot, retention, and post-removal gate tests**

```js
it("requires explicit removal authorization and one current snapshot per page", async () => {
  await expect(removeProject({
    projectRoot,
    pageIds: ["equipment-ops-7c31fa"],
    snapshots: [],
    confirmRemove: false,
    now
  })).rejects.toThrow("--confirm-remove is required");

  await expect(removeProject({
    projectRoot,
    pageIds: ["equipment-ops-7c31fa"],
    snapshots: [],
    confirmRemove: true,
    now
  })).rejects.toThrow("Current annotation snapshot is required for equipment-ops-7c31fa");
});

it("persists live annotations before removing only the HTML integration", async () => {
  const manifestPath = path.join(projectRoot, ".prd-annotator/manifest.json");
  const manifestBefore = readJson(manifestPath);
  const pageEntry = manifestBefore.pages[0];
  const annotationPath = path.join(projectRoot, pageEntry.annotationFile);
  const permanentBefore = readJson(annotationPath);
  const prdPath = path.join(projectRoot, "doc/prd/pages/equipment-ops.md");
  const prdBefore = readFileSync(prdPath, "utf8");
  const incoming = {
    ...permanentBefore.annotations[0],
    id: "A002",
    title: "Confirm batch disable",
    description: "The live browser contains a second annotation.",
    prdContent: "Batch disable shall require confirmation.",
    createdAt: "2026-08-09T01:00:00.000Z",
    updatedAt: "2026-08-09T01:00:00.000Z"
  };
  const liveDocument = {
    ...permanentBefore,
    annotations: [...permanentBefore.annotations, incoming]
  };
  const snapshot = {
    schemaVersion: 2,
    projectId: manifestBefore.project.id,
    pageId: pageEntry.id,
    annotationFingerprint: fingerprintValue(liveDocument.annotations),
    document: liveDocument
  };

  const result = await removeProject({
    projectRoot,
    pageIds: [pageEntry.id],
    snapshots: [snapshot],
    confirmRemove: true,
    now
  });

  expect(result.removedPages).toEqual([pageEntry.id]);
  expect(inspectIntegration(readFileSync(
    path.join(projectRoot, pageEntry.htmlPath),
    "utf8"
  ))).toHaveLength(0);
  expect(readJson(annotationPath).annotations.map((item) => item.id))
    .toEqual(["A001", "A002"]);
  expect(readJson(manifestPath).pages[0].display.enabled).toBe(false);
  expect(existsSync(path.join(projectRoot, ".prd-annotator/sdk/prd-annotator.js")))
    .toBe(true);
  expect(existsSync(path.join(projectRoot, pageEntry.viewFile))).toBe(true);
  expect(readFileSync(prdPath, "utf8")).toBe(prdBefore);
  await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1 });
});

it("rejects a snapshot belonging to another project or page", async () => {
  await expect(removeProject({
    projectRoot,
    pageIds: ["equipment-ops-7c31fa"],
    snapshots: [{
      schemaVersion: 2,
      projectId: "another-project-a1b2c3",
      pageId: "equipment-ops-7c31fa",
      document: validDocument
    }],
    confirmRemove: true,
    now
  })).rejects.toThrow("Snapshot project/page identity does not match the removal target");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx vitest run tests/unit/project-removal.test.js tests/unit/lifecycle.test.js
```

Expected: FAIL because no consent-gated removal orchestrator or manifest-aware removed-display gate exists.

- [ ] **Step 3: Implement synchronization-first removal**

`removeProject` must perform this sequence without reordering:

1. Require `confirmRemove === true` and a unique target page list.
2. Require one identity-matching snapshot per target page.
3. Validate and monotonically merge each snapshot into its permanent annotation file.
4. Assert that every live annotation ID exists in permanent JSON with an equal-or-newer `updatedAt`; permanent-only IDs remain untouched.
5. Regenerate view bundles so the persisted fingerprint reflects permanent JSON.
6. Run `checkProject({ projectRoot })` while integrations are still enabled.
7. Prepare every target HTML edit in memory with `removeIntegration`, require exactly one integration before removal, and change only that script tag.
8. Write the HTML edits and set each target manifest entry to `display: { enabled: false, updatedAt: now() }`.
9. Run the manifest-aware project gate again and report every changed file.

Do not edit PRDs, delete `.prd-annotator` files, remove browser storage, or expose a purge/reset mode. A snapshot with zero annotations never reduces permanent JSON.

- [ ] **Step 4: Add the explicit CLI and browser-cache retention assertion**

CLI syntax:

```text
node remove-project.mjs --project-root PATH --confirm-remove --page equipment-ops-7c31fa --snapshot TEMP/equipment-ops-snapshot.json
```

Allow repeated `--page` and `--snapshot`; match snapshots by embedded page ID rather than argument order. The global Skill must first save a direct browser snapshot or the delimited copied payload into a temporary JSON file. If the Agent cannot obtain a current snapshot, removal stops and the user sees the five-step copy/paste instructions.

Retain the lifecycle assertion that `unmount()` removes the host while `getSnapshot()` remains byte-equal and `Storage.prototype.removeItem` is never called. Add the built SDK to the prohibited-public-API scan so no `delete`, `clear`, `purge`, or `reset` method is exposed.

- [ ] **Step 5: Run removal, gate, and lifecycle tests**

```powershell
npx vitest run tests/unit/project-removal.test.js tests/unit/project-gate.test.js tests/unit/lifecycle.test.js
npm run build
```

Expected: PASS; enabled fixture pages require one integration, removed pages require zero, all permanent data remains, and the SDK still has no destructive API.

- [ ] **Step 6: Commit safe removal**

```powershell
git add prd-annotator-skill/scripts/remove-project.mjs prd-annotator-skill/scripts/lib/html.mjs prd-annotator-skill/scripts/merge-annotations.mjs prd-annotator-skill/scripts/check-project.mjs tests/unit/project-removal.test.js tests/unit/lifecycle.test.js
git commit -m "feat: remove display layer without data loss"
```

---

### Task 11: Explicit Managed PRDs and Non-destructive Legacy Migration

**Files:**
- Create: `prd-annotator-skill/scripts/lib/managed-prd.mjs`
- Create: `prd-annotator-skill/scripts/generate-prd.mjs`
- Create: `prd-annotator-skill/scripts/migrate-legacy.mjs`
- Create: `tests/unit/managed-prd.test.js`
- Create: `tests/unit/legacy-migration.test.js`
- Modify: `tests/unit/project-gate.test.js`

**Interfaces:**
- Produces: `renderManagedPagePrd(document): string`.
- Produces: `renderManagedTotalPrd(manifest, totalPrdFile): string`; links are relative to the total PRD's directory.
- Produces: `generateManagedPrd({ projectRoot, pageIds, total, documentRoot, confirmPrdWrite }): string[]`.
- Produces: `migrateLegacy({ projectRoot, authorization, confirmMigration, now }): ManifestV2`, where `authorization` is exactly `"install"` or `"upgrade"`.

- [ ] **Step 1: Write failing deterministic generation and migration tests**

```js
it("regenerates page Markdown byte-for-byte from page JSON", () => {
  const markdown = renderManagedPagePrd(documentWithManagedPrd);
  expect(markdown).toBe(
    "# Equipment Operations\n\n"
    + "## Goal\n\nKeep device operations safe.\n\n"
    + "## Requirements\n\n- Batch disable requires confirmation.\n"
  );
});

it("indexes every manifest page in a managed total PRD", () => {
  const totalPrdFile = "doc/prd/PRD.md";
  const markdown = renderManagedTotalPrd(manifest, totalPrdFile);
  for (const page of manifest.pages) {
    const relativeLink = path.posix.relative(
      path.posix.dirname(totalPrdFile),
      page.managedPrdFile
    );
    expect(markdown).toContain(`[${page.title}](${relativeLink})`);
  }
});

it("requires explicit migration and leaves every legacy source untouched", async () => {
  const before = await snapshotFiles(path.join(projectRoot, "doc/prd"));
  await expect(migrateLegacy({
    projectRoot,
    authorization: "install",
    confirmMigration: false
  }))
    .rejects.toThrow("--confirm-migration is required");
  await expect(migrateLegacy({
    projectRoot,
    authorization: null,
    confirmMigration: true,
    now
  })).rejects.toThrow("authorized install or upgrade is required");
  await migrateLegacy({
    projectRoot,
    authorization: "install",
    confirmMigration: true,
    now
  });
  expect(await snapshotFiles(path.join(projectRoot, "doc/prd"))).toEqual(before);
  expect(readJson(newAnnotationPath).annotations.map((item) => item.id))
    .toEqual(readJson(legacyAnnotationPath).annotations.map((item) => item.id));
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```powershell
npx vitest run tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js
```

Expected: FAIL because managed PRD and migration modules do not exist.

- [ ] **Step 3: Implement deterministic managed PRD rendering**

Store managed page source in `document.managedPrd`:

```js
{
  title: "Equipment Operations",
  sections: [
    { id: "goal", title: "Goal", blocks: ["Keep device operations safe."] },
    { id: "requirements", title: "Requirements", blocks: ["- Batch disable requires confirmation."] }
  ]
}
```

Render normalized LF output with one trailing newline. Total-PRD links are POSIX-style paths calculated relative to `managedTotalPrdFile`, never project-root paths copied verbatim. `generate-prd.mjs` requires `--confirm-prd-write`, accepts repeated `--page`, optionally `--total`, and optionally `--document-root PROJECT_RELATIVE_PATH`. If one document root exists, reuse it; if none exists, default to `doc/prd/pages/<page-id>.md` and `doc/prd/PRD.md`; if several roots are plausible and `--document-root` is absent, stop with the candidate list so the Skill can ask the user. Validate an explicit root as a project-contained relative path before writing.

Update the manifest with `managedPrdFile` and `managedTotalPrdFile` only for Skill-created documents. Regenerate views and run the project gate after writes.

- [ ] **Step 4: Implement legacy migration without moves or deletes**

`migrate-legacy.mjs` requires `--confirm-migration` together with exactly one of `--confirm-install` or `--confirm-upgrade`, reads `doc/prd/manifest.json`, normalizes every page record to v2, copies annotations into `.prd-annotator/data/pages`, inventories page/total PRDs at their original locations, writes new view files, and records:

```js
migration: {
  source: "doc/prd/manifest.json",
  migratedAt: "2026-08-09T00:00:00.000Z",
  sourceSha256: "<64 hex>",
  pageIdParityVerified: true
}
```

It never moves, edits, or deletes `doc/prd` sources. It fails before success if any legacy annotation ID is missing from the new canonical file.

- [ ] **Step 5: Add managed PRD checks to the project gate**

When `managedPrdFile` exists, render from page JSON and require byte equality with the Markdown file. When `managedTotalPrdFile` exists, regenerate with `renderManagedTotalPrd(manifest, managedTotalPrdFile)` and require byte equality, including one relative link for every manifest page. Do not apply these checks to external document entries.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js tests/unit/project-gate.test.js
git add prd-annotator-skill/scripts/lib/managed-prd.mjs prd-annotator-skill/scripts/generate-prd.mjs prd-annotator-skill/scripts/migrate-legacy.mjs tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js tests/unit/project-gate.test.js
git commit -m "feat: generate managed PRDs and migrate legacy data"
```

---

### Task 12: Global Skill Rewrite, Release Packaging, Product Docs, and Final Verification

**Files:**
- Modify: `prd-annotator-skill/SKILL.md`
- Create: `prd-annotator-skill/references/installation.md`
- Modify: `prd-annotator-skill/references/data-schema.md`
- Modify: `prd-annotator-skill/references/prd-workflow.md`
- Modify: `prd-annotator-skill/agents/openai.yaml`
- Create: `scripts/package-release.mjs`
- Create: `scripts/check-repository.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify outside Git worktree: `../doc/prd-annotator-usage.md`
- Create: `tests/unit/release-package.test.js`
- Modify: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: all SDK and Skill scripts from Tasks 1–11.
- Produces: global Skill instructions with self-relative script paths and consent gates.
- Produces: `npm run release:package` assets `dist/release/prd-annotator.js`, `prd-annotator.js.sha256`, and `release-manifest.json`.
- Produces: `npm run check:repo` for ASCII paths, destructive workflow scan, and runtime-service scan.

- [ ] **Step 1: Write failing Skill contract and Release package tests**

Require these Skill strings and reject old assumptions:

```js
const requiredContracts = [
  "explicit user authorization",
  ".prd-annotator/manifest.json",
  "latest formal GitHub Release",
  "--confirm-install",
  "--confirm-upgrade",
  "--confirm-remove",
  "data-view-src",
  "复制同步提示词",
  "complete annotation payload",
  "copying is not synchronization",
  "do not choose or merge ambiguous PRDs",
  "resolve scripts relative to this Skill directory"
];
for (const contract of requiredContracts) expect(skillSource).toContain(contract);
expect(skillSource).not.toContain("Locate `doc/prd/manifest.json`");
expect(skillSource).not.toContain("Do not ask the human to copy");

it("packages a checksum-verifiable SDK Release", async () => {
  await packageRelease({ repositoryRoot, outputRoot });
  const sdk = readFileSync(path.join(outputRoot, "prd-annotator.js"));
  const checksum = readFileSync(path.join(outputRoot, "prd-annotator.js.sha256"), "utf8").trim();
  expect(checksum).toBe(createHash("sha256").update(sdk).digest("hex"));
  expect(readJson(path.join(outputRoot, "release-manifest.json"))).toMatchObject({
    version: "2.0.0",
    assets: { sdk: "prd-annotator.js", checksum: "prd-annotator.js.sha256" }
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
```

Expected: FAIL because the Skill still assumes `doc/prd`, prohibits prompt copying, and has no Release packager.

- [ ] **Step 3: Rewrite the global Skill and references**

Before editing Skill files, invoke the `writing-skills` sub-skill and follow its validation workflow in addition to this task's TDD steps.

Keep `SKILL.md` under 300 lines. Its main flow must be:

1. Infer annotation/PRD intent semantically.
2. If the integration is absent, perform read-only discovery.
3. Install only after explicit user authorization.
4. Resolve every script from the installed Skill directory, never the target project.
5. Use latest formal Release only when missing; never overwrite or upgrade implicitly.
6. Scan explicit prototype source pages and all relevant documents.
7. Synchronize from direct snapshot when available or the complete pasted payload otherwise.
8. Run `check-project.mjs` after annotation/view/PRD changes.
9. Modify PRDs only on separate user intent; list ambiguous candidates and ask.
10. On explicit removal intent, obtain one current snapshot per target page and call `remove-project.mjs --confirm-remove`; never remove integration directly.

`references/installation.md` contains exact global-Skill installation guidance, per-project CLI examples, Release policy, authorization rules, and the relative-path gate. `data-schema.md` documents manifest/page/view schema v2, including `page.display`. `prd-workflow.md` documents universal synchronization, document ambiguity, managed/external PRDs, and snapshot-verified safe removal. `openai.yaml` describes the Skill without implying automatic installation.

The PRD workflow must state that annotation synchronization alone never edits a PRD and that no magic phrase is required for later PRD work. On separate natural-language PRD intent, use an explicitly named document or the sole unambiguous target; list candidates and ask when several are plausible. Clear page-only impact updates only the selected page PRD. Clear public-rule, cross-page-flow, or total-scope impact also updates the already identified total PRD and reports a change summary; if that total target is ambiguous, stop and ask. When no PRD root exists and creation was explicitly requested, use `doc/prd/`; when several roots exist, ask before passing an output path.

- [ ] **Step 4: Implement Release packaging and repository scans**

Set package version to `2.0.0` and add:

```json
{
  "scripts": {
    "release:package": "npm run build && node scripts/package-release.mjs",
    "check:repo": "node scripts/check-repository.mjs"
  }
}
```

`package-release.mjs` clears only its explicit `dist/release` output entries, copies the built SDK, writes lowercase SHA-256, and writes the Release manifest. `check-repository.mjs` obtains tracked paths with `git ls-files`, fails on non-ASCII tracked paths, scans runtime JavaScript and Skill scripts for save servers/endpoints and destructive project-data methods, and permits only the HTML integration removal helper. Test-fixture cleanup and the packager's explicit `dist/release` cleanup are outside the project-data scan.

- [ ] **Step 5: Update README and the workspace user guide**

README must explain:

- Global Skill installation source.
- Explicit per-project authorization.
- What `.prd-annotator` contains.
- The two-button browser flow.
- The five-step copy/paste synchronization process.
- Why prompt data is embedded for non-browser-capable Agents.
- Safe display-layer removal.

Update `D:\Codexdoc\My\project_prdjs\doc\prd-annotator-usage.md` with the same non-technical workflow and troubleshooting for `file://`, memory-only state, GitHub failure, stale views, and ambiguous PRDs. This file is outside the `code` Git worktree, so verify it separately and mention it in the final handoff; do not attempt to add it to the repository commit.

- [ ] **Step 6: Validate the Skill and run the complete suite**

Run:

```powershell
npm run test:unit
npm run build
npm run test:e2e
npm run release:package
npm run check:repo
python "C:/Users/28920/.codex/skills/.system/skill-creator/scripts/quick_validate.py" "D:/Codexdoc/My/project_prdjs/code/prd-annotator-skill"
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
git diff --check
```

Expected:

- All unit tests PASS.
- Build PASS.
- All Playwright tests PASS.
- Release package contains three checksum-consistent assets.
- Repository scan PASS with ASCII tracked paths and no runtime save service/destructive data workflow.
- Skill validator prints a valid Skill result.
- Project gate prints `PRD Annotator gate passed: 1 pages, 1 annotations, 2 documents` for the final fixture.
- `git diff --check` prints nothing.

- [ ] **Step 7: Commit the global Skill and Release workflow**

```powershell
git add prd-annotator-skill scripts/package-release.mjs scripts/check-repository.mjs package.json package-lock.json README.md tests/unit/release-package.test.js tests/unit/skill-scripts.test.js
git commit -m "feat: ship global PRD annotator workflow"
```

- [ ] **Step 8: Final clean-tree verification and handoff**

```powershell
git status --short
git log --oneline -15
```

Expected: `git status --short` prints nothing. Report the installed/tested SDK version, test counts, Release asset paths, Skill validation, project gate output, the external product-guide path, and that no push was performed unless the user explicitly requested one.

---

## Spec Coverage Map

| Approved design area | Implemented and verified by |
| --- | --- |
| Authorization boundary, global Skill behavior, and self-relative scripts | Tasks 6, 7, and 12 |
| Formal Release selection, checksum, version preservation, and explicit upgrade | Tasks 7 and 12 |
| Prototype discovery, ambiguity handling, exclusions, ASCII identity, and path gate | Tasks 6, 7, and 9 |
| Browser annotation fields, target recovery, markers, Drawer, mobile layout, and exactly two buttons | Tasks 1–5 |
| Browser cache recovery, v1 fallback, memory-only warning, universal prompt, and sync state | Tasks 1, 4, 5, and 9 |
| Whole-project document inventory, ambiguous PRDs, missing assets, previews, and view regeneration | Tasks 3, 8, 9, and 12 |
| Permanent monotonic annotation merge and complete project gates | Tasks 6, 8, and 9 |
| Separate PRD authorization, managed regeneration, total index, and external-PRD preservation | Tasks 11 and 12 |
| Snapshot-verified display removal with all data retained | Tasks 9, 10, and 12 |
| Non-destructive legacy migration | Tasks 1, 9, and 11 |
| Unit, static-file, HTTP, mobile, Release, Skill, repository, and final acceptance verification | Tasks 5, 9, 10, and 12 |

---

## Plan Completion Criteria

- Every Task commit is independently reviewable and its focused tests pass before the next Task begins.
- The complete suite passes after Task 12.
- The final repository implements every requirement in `docs/superpowers/specs/2026-08-09-global-prd-annotator-skill-design.md`.
- No project is mutated without explicit SDK authorization.
- No annotation is lost during cache migration, synchronization, legacy migration, or display-layer removal.
- All relevant/ambiguous PRDs are visible and none are silently selected or merged.
- The static SDK remains service-free and shows exactly two floating controls.
