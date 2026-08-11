# Annotation Form and Card Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify new and edited annotations to title, description, type, PRD content, and note while preserving all historical schema-v2 data and presenting annotations as compact sectioned cards.

**Architecture:** Keep the browser SDK and Agent-side schema normalizers structurally identical for shared fields. New records explicitly create `note`, normalizers preserve optional properties without synthesizing them, and edit operations merge only the five visible fields. Drawer rendering changes presentation only and never removes legacy data.

**Tech Stack:** JavaScript ES2022, Node.js 20.11+, Vitest 3, jsdom 26, Playwright 1.55, esbuild 0.25.

## Global Constraints

- Keep `schemaVersion: 2`; do not introduce a migration version.
- New annotations contain `note`, with an empty input stored as `""`.
- New annotations do not contain `acceptanceCriteria`, `dataFields`, `apiPath`, or `edgeCases`.
- Existing optional legacy fields and unknown compatible properties must survive normalization, cache, snapshot, merge, View generation, and editing unchanged.
- Annotation work never creates or edits a PRD, field specification, API document, or related document.
- Keep browser runtime service-free and add no runtime dependency.
- Keep page identity, tombstone deletion, stable marker numbering, and display-layer removal behavior unchanged.
- Source files remain ASCII-only paths; user-visible text may remain Chinese UTF-8.
- Do not hand-edit `prd-annotator/prd-annotator.js`; regenerate it with `npm run build`.
- This plan does not bump the package or SDK version and does not publish a Release.
- Approved design: `docs/superpowers/specs/2026-08-11-annotation-and-document-quality-design.md`.

---

## File Map

- `prd-annotator/src/model.js`: Browser normalization, optional-field validation, fingerprint input.
- `prd-annotator-skill/scripts/lib/schema.mjs`: Agent-side schema parity with the browser model.
- `prd-annotator-skill/scripts/check-project.mjs`: Permanent-project gate for optional note and legacy fields.
- `prd-annotator/src/ui/editor.js`: Five-field create/edit dialog.
- `prd-annotator/src/runtime/controller.js`: New-record shape and merge-edit field whitelist.
- `prd-annotator/src/ui/drawer.js`: Compact annotation card DOM.
- `prd-annotator/src/ui/styles.js`: Card layout, section labels, direct-child list selector.
- `prd-annotator-skill/references/data-schema.md`: Public schema-v2 compatibility contract.
- `tests/unit/model.test.js`: Browser normalization and validation tests.
- `tests/unit/project-discovery.test.js`: Browser/Agent schema parity tests.
- `tests/unit/project-gate.test.js`: Permanent JSON gate tests.
- `tests/unit/skill-scripts.test.js`: Merge preservation and global Skill boundary tests.
- `tests/unit/annotation-flow.test.js`: Editor, edit merge, fingerprint state, and card tests.
- `tests/unit/prd-drawer.test.js`: Historical card presentation tests.
- `tests/e2e/prd-annotator.spec.js`: Browser persistence and end-to-end compatibility.
- `prd-annotator/prd-annotator.js`: Generated single-file SDK output.

### Task 1: Preserve optional fields in the browser model

**Files:**
- Modify: `tests/unit/model.test.js`
- Modify: `prd-annotator/src/model.js`

**Interfaces:**
- Consumes: schema-v2 annotation objects and legacy v1 annotation objects.
- Produces: `normalizeAnnotationDocument(value, defaults)`, `assertValidDocument(document)`, and unchanged `annotationFingerprintInput(document)` behavior.

- [ ] **Step 1: Replace the legacy normalization expectation and add optional-field tests**

In `tests/unit/model.test.js`, change the v1 expectation so normalization supplies required v2 fields without inventing the four retired fields, then add these tests inside `describe("annotation document", ...)`:

```js
it("does not synthesize retired fields while normalizing legacy input", () => {
  const migrated = normalizeAnnotationDocument(v1Document, {
    projectId: "device-demo-a13f92",
    htmlPath: "prototype/index.html"
  });

  expect(migrated.annotations[0]).toMatchObject({
    id: "A001",
    title: "Batch disable",
    description: "Batch disable",
    type: "requirement",
    prdContent: "Batch disable"
  });
  for (const field of [
    "note",
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ]) {
    expect(migrated.annotations[0]).not.toHaveProperty(field);
  }
});

it("preserves optional note, retired fields, and unknown compatible fields", () => {
  const source = {
    ...v1Document,
    schemaVersion: 2,
    annotations: [{
      ...v1Document.annotations[0],
      title: "Batch disable",
      description: "Add a batch action.",
      type: "requirement",
      prdContent: "Selected devices can be disabled together.",
      note: "Discuss wording with operations.",
      acceptanceCriteria: "Confirm before changing state.",
      dataFields: "deviceIds: string[]",
      apiPath: "POST /api/devices/batch-disable",
      edgeCases: "Reject an empty selection.",
      legacyExtension: { owner: "operations" }
    }]
  };

  const [annotation] = normalizeAnnotationDocument(source).annotations;
  expect(annotation).toMatchObject({
    note: "Discuss wording with operations.",
    acceptanceCriteria: "Confirm before changing state.",
    dataFields: "deviceIds: string[]",
    apiPath: "POST /api/devices/batch-disable",
    edgeCases: "Reject an empty selection.",
    legacyExtension: { owner: "operations" }
  });
});

it.each([
  ["note", 1],
  ["acceptanceCriteria", []],
  ["dataFields", {}],
  ["apiPath", false],
  ["edgeCases", null]
])("rejects non-string optional annotation field %s", (field, value) => {
  const document = normalizeAnnotationDocument({
    ...v1Document,
    schemaVersion: 2,
    annotations: [{
      ...v1Document.annotations[0],
      title: "Batch disable",
      description: "Add a batch action.",
      type: "requirement",
      prdContent: "Selected devices can be disabled together.",
      [field]: value
    }]
  });

  expect(() => assertValidDocument(document))
    .toThrow(`Invalid annotation A001.${field}`);
});

it("requires an annotation target recovery signal", () => {
  const document = normalizeAnnotationDocument({
    ...v1Document,
    schemaVersion: 2,
    annotations: [{
      ...v1Document.annotations[0],
      title: "Batch disable",
      description: "Add a batch action.",
      type: "requirement",
      prdContent: "Selected devices can be disabled together.",
      target: {
        cssPath: "",
        xpath: "",
        textQuote: "",
        rect: { x: 0, y: 0, width: 10, height: 10 }
      }
    }]
  });

  expect(() => assertValidDocument(document))
    .toThrow("Invalid annotation A001.target");
});
```

- [ ] **Step 2: Run the browser-model tests and verify the intended failure**

Run:

```powershell
npx vitest run tests/unit/model.test.js
```

Expected: FAIL because normalization still synthesizes four retired fields and validation does not reject invalid optional fields or an empty target identity.

- [ ] **Step 3: Make browser normalization preserve optional properties without synthesizing them**

In `prd-annotator/src/model.js`, remove the four retired field assignments from `normalizeAnnotation`. Keep `...clone(annotation)` first so present optional and unknown properties survive, and keep required-field normalization after it:

```js
const OPTIONAL_ANNOTATION_TEXT_FIELDS = [
  "note",
  "acceptanceCriteria",
  "dataFields",
  "apiPath",
  "edgeCases"
];

function normalizeAnnotation(annotation = {}) {
  const comment = String(annotation.comment || "");
  const prd = annotation.prd || {};
  return {
    ...clone(annotation),
    id: String(annotation.id || ""),
    title: String(annotation.title || comment),
    description: String(annotation.description || comment),
    type: ANNOTATION_TYPES.includes(annotation.type) ? annotation.type : "requirement",
    prdContent: String(annotation.prdContent || comment),
    status: ANNOTATION_STATUSES.includes(annotation.status) ? annotation.status : "open",
    createdAt: String(annotation.createdAt || ""),
    updatedAt: String(annotation.updatedAt || annotation.createdAt || ""),
    target: clone(annotation.target || {
      cssPath: "",
      xpath: "",
      textQuote: "",
      rect: { x: 0, y: 0, width: 0, height: 0 }
    }),
    prd: {
      ...clone(prd),
      linkedDocuments: Array.isArray(prd.linkedDocuments) ? clone(prd.linkedDocuments) : [],
      linkedSections: Array.isArray(prd.linkedSections) ? clone(prd.linkedSections) : [],
      impactScope: IMPACT_SCOPES.includes(prd.impactScope) ? prd.impactScope : "page",
      summary: String(prd.summary || "")
    }
  };
}
```

Inside the active-annotation loop in `assertValidDocument`, require `prdContent`, validate optional properties only when present, and require at least one target recovery string:

```js
if (
  !annotation.id
  || !annotation.title
  || !annotation.description
  || !annotation.prdContent
  || !annotation.target
) {
  throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
}
for (const field of OPTIONAL_ANNOTATION_TEXT_FIELDS) {
  if (
    Object.prototype.hasOwnProperty.call(annotation, field)
    && typeof annotation[field] !== "string"
  ) {
    throw new Error(`Invalid annotation ${annotation.id}.${field}`);
  }
}
if (!["cssPath", "xpath", "textQuote"].some(
  (field) => typeof annotation.target[field] === "string"
    && annotation.target[field].trim()
)) {
  throw new Error(`Invalid annotation ${annotation.id}.target`);
}
```

- [ ] **Step 4: Run the browser-model tests**

Run:

```powershell
npx vitest run tests/unit/model.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit browser model compatibility**

```powershell
git add prd-annotator/src/model.js tests/unit/model.test.js
git commit -m "refactor: preserve optional annotation fields"
```

### Task 2: Apply the same optional-field contract to Agent gates and merge

**Files:**
- Modify: `tests/unit/project-discovery.test.js`
- Modify: `tests/unit/project-gate.test.js`
- Modify: `tests/unit/skill-scripts.test.js`
- Modify: `prd-annotator-skill/scripts/lib/schema.mjs`
- Modify: `prd-annotator-skill/scripts/check-project.mjs`
- Modify: `prd-annotator-skill/references/data-schema.md`

**Interfaces:**
- Consumes: Browser snapshots and permanent page JSON.
- Produces: Browser/Agent normalization parity and `validateCompleteAnnotationDocument(document, options)` accepting optional note and legacy fields.

- [ ] **Step 1: Add schema parity and permanent-gate tests**

In `tests/unit/project-discovery.test.js`, extend the existing schema parity test with a native v2 annotation that has `note`, all four historical fields, and `legacyExtension`, then compare Browser and Agent normalization exactly:

```js
const compatibleV2 = {
  ...v1Document,
  schemaVersion: 2,
  annotations: [{
    ...v1Document.annotations[0],
    title: "Need a status",
    description: "Show the current status.",
    type: "requirement",
    prdContent: "The status remains visible.",
    note: "Confirm the label.",
    acceptanceCriteria: "Status is visible.",
    dataFields: "status: string",
    apiPath: "GET /api/status",
    edgeCases: "Unknown status uses a fallback.",
    legacyExtension: { source: "v2.2" }
  }]
};
expect(skillNormalizeAnnotationDocument(compatibleV2, defaults))
  .toEqual(browserNormalizeAnnotationDocument(compatibleV2, defaults));
```

In `tests/unit/project-gate.test.js`, add one passing case and two failing cases near the existing annotation completeness tests:

```js
it("accepts new annotations without retired fields and preserves optional history", async () => {
  const projectRoot = copyFixture();
  const annotationPath = projectPath(projectRoot, annotationRelativePath);
  const permanent = readJson(annotationPath);
  const historical = permanent.annotations[0];
  historical.note = "Historical note";
  const fresh = {
    ...historical,
    id: "A002",
    title: "Fresh annotation",
    note: "",
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z"
  };
  for (const field of [
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ]) delete fresh[field];
  permanent.annotations.push(fresh);
  writeJson(annotationPath, permanent);
  await refreshProject({
    projectRoot,
    now: new Date("2026-08-11T10:01:00.000Z")
  });

  await expect(checkProject({ projectRoot }))
    .resolves.toMatchObject({ annotations: 2 });
});

it.each([
  ["note", 1],
  ["apiPath", []]
])("rejects non-string optional field %s", async (field, value) => {
  const projectRoot = copyFixture();
  const annotationPath = projectPath(projectRoot, annotationRelativePath);
  const permanent = readJson(annotationPath);
  permanent.annotations[0][field] = value;
  writeJson(annotationPath, permanent);

  await expect(checkProject({ projectRoot }))
    .rejects.toThrow(`annotation A001.${field} must be a string`);
});
```

In `tests/unit/skill-scripts.test.js`, change the annotation fixture to create `note: ""` and omit the four retired properties by default. Add a merge test proving a newer edit preserves retired and unknown fields when the incoming record contains them:

```js
it("merges note while retaining historical optional and unknown fields", async () => {
  const projectRoot = copyFixture();
  const permanent = readJson(annotationPath(projectRoot));
  permanent.annotations[0].legacyExtension = { source: "v2.2" };
  writeJson(annotationPath(projectRoot), permanent);

  const incoming = {
    ...permanent.annotations[0],
    note: "Updated note",
    updatedAt: "2026-08-11T10:00:00.000Z"
  };
  const merged = await mergeSnapshot({
    projectRoot,
    snapshot: rawSnapshot([incoming])
  });

  expect(merged.annotations[0]).toMatchObject({
    note: "Updated note",
    acceptanceCriteria: permanent.annotations[0].acceptanceCriteria,
    dataFields: permanent.annotations[0].dataFields,
    apiPath: permanent.annotations[0].apiPath,
    edgeCases: permanent.annotations[0].edgeCases,
    legacyExtension: { source: "v2.2" }
  });
});
```

- [ ] **Step 2: Run the Agent schema and gate tests to verify failure**

Run:

```powershell
npx vitest run tests/unit/project-discovery.test.js tests/unit/project-gate.test.js tests/unit/skill-scripts.test.js
```

Expected: FAIL because Agent normalization still synthesizes retired fields and the permanent gate still requires all four.

- [ ] **Step 3: Mirror browser normalization in `schema.mjs`**

In `prd-annotator-skill/scripts/lib/schema.mjs`, remove the four retired field assignments from `normalizeAnnotation`. Preserve `...clone(annotation)` before required normalized fields exactly as in Task 1. Add this module constant:

```js
const OPTIONAL_ANNOTATION_TEXT_FIELDS = [
  "note",
  "acceptanceCriteria",
  "dataFields",
  "apiPath",
  "edgeCases"
];
```

In `validateAnnotationDocument`, validate the five optional properties only when present and require at least one non-empty recovery string, using the same logic and error messages as `prd-annotator/src/model.js`.

- [ ] **Step 4: Make the permanent project gate accept optional fields**

In `prd-annotator-skill/scripts/check-project.mjs`, replace the unconditional legacy-field loop with:

```js
for (const field of [
  "note",
  "acceptanceCriteria",
  "dataFields",
  "apiPath",
  "edgeCases"
]) {
  if (Object.prototype.hasOwnProperty.call(annotation, field)) {
    assertString(annotation[field], `${annotationLabel}.${field}`);
  }
}
```

After validating `cssPath`, `xpath`, and `textQuote` as strings, add:

```js
if (!["cssPath", "xpath", "textQuote"].some(
  (field) => annotation.target[field].trim()
)) {
  fail(`${annotationLabel}.target must contain a recovery signal`);
}
```

Do not change the existing status, timestamp, `prd`, linked-document, tombstone, or managed-PRD gates.

- [ ] **Step 5: Update the schema reference with the exact compatibility contract**

In `prd-annotator-skill/references/data-schema.md`:

- Replace the primary annotation example's four retired fields with `"note": "Confirm wording with operations."`.
- Add a `Historical optional fields` subsection naming `acceptanceCriteria`, `dataFields`, `apiPath`, and `edgeCases`.
- State that new records must not create those four fields, historical records must retain them, and edit is a five-field merge.
- State that `note` is optional for historical input, is a string when present, and is written as `""` by the new editor when blank.
- State that note participates in the annotation fingerprint without changing the fingerprint algorithm.
- Preserve all tombstone, route identity, generated View, removal, and path invariants.

- [ ] **Step 6: Run Agent schema, gate, and merge tests**

Run:

```powershell
npx vitest run tests/unit/project-discovery.test.js tests/unit/project-gate.test.js tests/unit/skill-scripts.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Agent-side compatibility**

```powershell
git add prd-annotator-skill/scripts/lib/schema.mjs prd-annotator-skill/scripts/check-project.mjs prd-annotator-skill/references/data-schema.md tests/unit/project-discovery.test.js tests/unit/project-gate.test.js tests/unit/skill-scripts.test.js
git commit -m "feat: gate optional annotation notes compatibly"
```

### Task 3: Simplify create and edit to five visible fields

**Files:**
- Modify: `tests/unit/annotation-flow.test.js`
- Modify: `prd-annotator/src/ui/editor.js`
- Modify: `prd-annotator/src/runtime/controller.js`

**Interfaces:**
- Consumes: `openEditor({ container, target, initialValue, onSave, onCancel })`.
- Produces: form values `{ title, description, type, prdContent, note }`; new annotation objects with `note`; merge edits that preserve all non-editable properties.

- [ ] **Step 1: Rewrite the annotation-flow form helper and creation test**

Replace `fillRequiredForm`'s default value with:

```js
const formValue = {
  title: "Batch disable",
  description: "Add a batch action.",
  type: "requirement",
  prdContent: "Selected devices can be disabled together.",
  note: "Confirm wording with operations.",
  ...values
};
```

Replace the creation test with:

```js
it("saves the simplified annotation fields without retired properties", () => {
  const { api, shadow } = openAnnotationEditor();
  fillRequiredForm(shadow);

  for (const field of [
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ]) {
    expect(shadow.querySelector(`[data-field='${field}']`)).toBeNull();
  }
  shadow.querySelector("[data-action='save-annotation']").click();

  const saved = api.getSnapshot().document.annotations[0];
  expect(saved).toMatchObject({
    title: "Batch disable",
    description: "Add a batch action.",
    type: "requirement",
    prdContent: "Selected devices can be disabled together.",
    note: "Confirm wording with operations."
  });
  for (const field of [
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ]) expect(saved).not.toHaveProperty(field);
});

it("stores an empty note string", () => {
  const { api, shadow } = openAnnotationEditor();
  fillRequiredForm(shadow, { note: "   " });
  shadow.querySelector("[data-action='save-annotation']").click();

  expect(api.getSnapshot().document.annotations[0].note).toBe("");
});

it("includes note changes in the annotation fingerprint", async () => {
  const timestamps = [
    "2026-08-11T09:00:00.000Z",
    "2026-08-11T09:05:00.000Z"
  ];
  const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });
  fillRequiredForm(shadow, { note: "First note" });
  shadow.querySelector("[data-action='save-annotation']").click();
  const before = api.getSnapshot().annotationFingerprint;
  api.hydrateView({
    schemaVersion: 2,
    generatedAt: "2026-08-11T09:01:00.000Z",
    projectId: api.getSnapshot().document.projectId,
    page: api.getSnapshot().document.page,
    persistedAnnotationFingerprint: before,
    document: api.getSnapshot().document,
    documents: []
  });
  shadow.querySelector("[data-action='toggle-drawer']").click();
  shadow.querySelector("[data-action='edit-annotation']").click();
  shadow.querySelector("[data-field='note']").value = "Second note";
  shadow.querySelector("[data-action='save-annotation']").click();
  await Promise.resolve();

  expect(api.getSnapshot().annotationFingerprint).not.toBe(before);
  expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
    .toBe("browser-only");
});
```

Add an edit-merge test that hydrates a historical annotation, edits all five visible fields, and proves old and unknown fields survive:

```js
it("edits five visible fields without clearing historical properties", () => {
  const { api, shadow } = openAnnotationEditor({
    now: () => "2026-08-11T10:00:00.000Z"
  });
  const page = api.getSnapshot().document.page;
  api.hydrate({
    document: {
      ...api.getSnapshot().document,
      page,
      annotations: [{
        id: "A001",
        title: "Historical",
        description: "Historical description",
        type: "change",
        prdContent: "Historical PRD content",
        acceptanceCriteria: "Historical acceptance",
        dataFields: "legacyField: string",
        apiPath: "GET /api/legacy",
        edgeCases: "Historical edge case",
        status: "open",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        target: {
          cssPath: "#device-list",
          xpath: "/html/body/main/section",
          textQuote: "Device list",
          rect: { x: 0, y: 0, width: 10, height: 10 }
        },
        prd: {
          linkedDocuments: ["doc-page-primary"],
          linkedSections: ["3.2 Batch operations"],
          impactScope: "page",
          summary: "Historical summary"
        },
        legacyExtension: { owner: "operations" }
      }]
    }
  });
  shadow.querySelector("[data-action='toggle-drawer']").click();
  shadow.querySelector("[data-action='edit-annotation']").click();
  const edits = {
    title: "Updated",
    description: "Updated description",
    type: "requirement",
    prdContent: "Updated PRD content",
    note: "New note"
  };
  for (const [field, value] of Object.entries(edits)) {
    shadow.querySelector(`[data-field='${field}']`).value = value;
  }
  shadow.querySelector("[data-action='save-annotation']").click();

  expect(api.getSnapshot().document.annotations[0]).toMatchObject({
    ...edits,
    acceptanceCriteria: "Historical acceptance",
    dataFields: "legacyField: string",
    apiPath: "GET /api/legacy",
    edgeCases: "Historical edge case",
    legacyExtension: { owner: "operations" },
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-11T10:00:00.000Z"
  });
});
```

- [ ] **Step 2: Run the annotation-flow tests to verify failure**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js
```

Expected: FAIL because the editor still exposes and the controller still creates the four retired fields.

- [ ] **Step 3: Replace the editor field list**

In `prd-annotator/src/ui/editor.js`, replace `fields` with:

```js
const fields = [
  { name: "title", label: "标题", required: true, control: "input" },
  { name: "description", label: "说明", required: true, control: "textarea" },
  { name: "type", label: "类型", required: true, control: "select" },
  { name: "prdContent", label: "PRD 内容", required: true, control: "textarea" },
  { name: "note", label: "备注", control: "textarea" }
];
```

Keep `prdContent` at five rows and all other textareas at three rows. The existing initialization already renders absent historical `note` as blank without mutating the annotation.

- [ ] **Step 4: Change new-record and edit-whitelist shapes**

In `prd-annotator/src/runtime/controller.js`, replace `createAnnotation` and `editableAnnotationFields` with:

```js
function createAnnotation(formValue, target, id, timestamp) {
  return {
    id,
    title: formValue.title,
    description: formValue.description,
    type: formValue.type,
    prdContent: formValue.prdContent,
    note: formValue.note,
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

function editableAnnotationFields(formValue) {
  return {
    title: formValue.title,
    description: formValue.description,
    type: formValue.type,
    prdContent: formValue.prdContent,
    note: formValue.note
  };
}
```

Do not change the existing edit spread/merge order: the stored annotation remains the base, the five editable fields overwrite it, and `updatedAt` changes last.

- [ ] **Step 5: Run annotation-flow and sync-state tests**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/sync-status.test.js tests/unit/sync-prompt.test.js
```

Expected: PASS, including the existing identity, focus, delete, marker, and sync tests.

- [ ] **Step 6: Commit the simplified editor**

```powershell
git add prd-annotator/src/ui/editor.js prd-annotator/src/runtime/controller.js tests/unit/annotation-flow.test.js
git commit -m "feat: simplify annotation content fields"
```

### Task 4: Render compact sectioned annotation cards

**Files:**
- Modify: `tests/unit/annotation-flow.test.js`
- Modify: `tests/unit/prd-drawer.test.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/styles.js`

**Interfaces:**
- Consumes: normalized active annotations, `onEdit(id)`, and `onDelete(id)`.
- Produces: one `.annotation-card` per annotation with `.annotation-card-header`, `.annotation-section`, and top-row actions.

- [ ] **Step 1: Add compact-card DOM and visibility tests**

In `tests/unit/annotation-flow.test.js`, replace the old complete-detail assertion with:

```js
it("renders a compact card with labeled sections and top-row actions", () => {
  const { shadow } = openAnnotationEditor();
  fillRequiredForm(shadow);
  shadow.querySelector("[data-action='save-annotation']").click();
  shadow.querySelector("[data-action='toggle-drawer']").click();

  const card = shadow.querySelector(".annotation-list > .annotation-card");
  expect(card.querySelector(".annotation-card-header")).not.toBeNull();
  expect(card.querySelector(".annotation-number").textContent).toBe("1");
  expect(card.querySelector(".annotation-title").textContent).toBe("Batch disable");
  expect(card.querySelector(".annotation-actions").parentElement)
    .toBe(card.querySelector(".annotation-card-header"));
  expect([...card.querySelectorAll(".annotation-section-label")]
    .map((node) => node.textContent))
    .toEqual(["说明", "PRD 内容", "备注"]);
  expect(card.textContent).toContain("Confirm wording with operations.");
});
```

In `tests/unit/prd-drawer.test.js`, add a test using an annotation with all four old fields, an empty note, and two linked sections:

```js
it("hides retired fields and keeps linked sections readable", () => {
  const historical = {
    ...annotation("A001"),
    title: "Historical annotation",
    description: "Historical description",
    type: "requirement",
    prdContent: "Historical PRD content",
    acceptanceCriteria: "Hidden acceptance",
    dataFields: "hiddenField: string",
    apiPath: "GET /api/hidden",
    edgeCases: "Hidden edge case",
    note: "",
    prd: {
      linkedDocuments: [],
      linkedSections: ["3.2 Batch operations", "5.1 Permissions"],
      impactScope: "page",
      summary: "Hidden summary"
    }
  };
  const api = createAnnotator({ window, document, scriptSrc: "https://example.test/sdk.js" });
  api.mount();
  api.hydrate({
    document: {
      ...createEmptyDocument(api.getSnapshot().document.page),
      annotations: [historical]
    }
  });
  const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
  shadow.querySelector("[data-action='toggle-drawer']").click();
  const card = shadow.querySelector(".annotation-card");

  expect(card.textContent).not.toContain("Hidden acceptance");
  expect(card.textContent).not.toContain("hiddenField");
  expect(card.textContent).not.toContain("GET /api/hidden");
  expect(card.textContent).not.toContain("Hidden edge case");
  expect(card.querySelector("[data-section='note']")).toBeNull();
  expect([...card.querySelectorAll(".linked-sections > li")]
    .map((node) => node.textContent))
    .toEqual(["3.2 Batch operations", "5.1 Permissions"]);
});
```

- [ ] **Step 2: Run card tests to verify failure**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js
```

Expected: FAIL because the current DOM has no labeled sections and still displays retired fields.

- [ ] **Step 3: Replace annotation-card construction in `drawer.js`**

Add this helper above `renderAnnotationList`:

```js
function appendAnnotationSection(container, { id, label, value }) {
  if (!String(value || "").trim()) return null;
  const section = container.ownerDocument.createElement("section");
  section.className = "annotation-section";
  section.dataset.section = id;
  const heading = container.ownerDocument.createElement("h5");
  heading.className = "annotation-section-label";
  heading.textContent = label;
  const content = container.ownerDocument.createElement("p");
  content.className = "annotation-section-content";
  content.textContent = value;
  section.append(heading, content);
  container.append(section);
  return section;
}
```

Refactor each list item to this exact hierarchy while keeping the current callbacks and ARIA labels:

```text
li.annotation-card[data-annotation-id]
  header.annotation-card-header
    span.annotation-number
    div.annotation-heading
      h4.annotation-title
      div.annotation-metadata
        span.annotation-type
        span.status
    div.annotation-actions
      button[data-action=edit-annotation]
      button[data-action=delete-annotation]
  div.annotation-sections
    section[data-section=description]
    section[data-section=prd-content]
    section[data-section=note] only when note is non-empty
    section[data-section=linked-sections] only when linked sections exist
```

Use `appendAnnotationSection` for description, PRD content, and note. Render linked sections as a labeled section whose body is the existing `.linked-sections` list. Remove rendering for `acceptanceCriteria`, `dataFields`, `apiPath`, `edgeCases`, `prd.summary`, and the impact badge. Do not delete or mutate those data properties.

- [ ] **Step 4: Replace card CSS and fix the nested-list selector**

In `prd-annotator/src/ui/styles.js`:

- Change `.annotation-list li` to `.annotation-list > li`.
- Make `.annotation-card` a block card rather than a two-column grid.
- Add the following focused styles:

```css
  .annotation-list > li {
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
  }

  .annotation-card-header {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
  }

  .annotation-heading {
    min-width: 0;
  }

  .annotation-card-header .annotation-actions {
    margin-top: 0;
  }

  .annotation-sections {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    padding-left: 40px;
  }

  .annotation-section {
    min-width: 0;
  }

  .annotation-section-label {
    margin: 0 0 4px;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .annotation-section-content {
    margin: 0 !important;
    color: #334155;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .linked-sections > li {
    display: list-item;
    border: 0;
    padding: 0;
    background: transparent;
    overflow-wrap: anywhere;
  }
```

Under the existing `@media (max-width: 520px)` block, set `.annotation-card-header` to `grid-template-columns: 30px minmax(0, 1fr)` and make `.annotation-actions` plus `.annotation-sections` start in column 2 so actions remain usable without widening the Drawer.

- [ ] **Step 5: Run card and accessibility regressions**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js tests/unit/drawer-tabs.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit compact cards**

```powershell
git add prd-annotator/src/ui/drawer.js prd-annotator/src/ui/styles.js tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js
git commit -m "feat: organize annotations into compact cards"
```

### Task 5: Verify persistence, build the single-file SDK, and close the annotation plan

**Files:**
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `prd-annotator/prd-annotator.js` through the build only

**Interfaces:**
- Consumes: the five-field editor, browser cache, copied payload, and generated bundle.
- Produces: a tested single-file SDK containing the simplified annotation experience.

- [ ] **Step 1: Update end-to-end annotation data and assertions**

In `tests/e2e/prd-annotator.spec.js`:

- Replace every fill of the four retired form controls with `await host.locator("[data-field='note']").fill("...")` where content is relevant.
- Update `annotationValues` to contain only `title`, `description`, `type`, `prdContent`, and `note`.
- After creation, assert each retired property is absent from the snapshot.
- After reload and copied-payload extraction, assert `note` remains unchanged and the complete payload equals the snapshot.
- Keep the edit/delete, stable marker, hash-route, multi-HTML, local file, unmount, and display removal cases unchanged except for their form fields.
- Add this historical-data assertion to the persistence test after hydration or reload:

```js
const historical = await page.evaluate(() => {
  const snapshot = window.PRDAnnotator.getSnapshot();
  const annotation = snapshot.document.annotations[0];
  return {
    note: annotation.note,
    hasAcceptanceCriteria: Object.hasOwn(annotation, "acceptanceCriteria")
  };
});
expect(historical.note).toBe(annotationValues.note);
expect(historical.hasAcceptanceCriteria).toBe(false);
```

- [ ] **Step 2: Run the focused browser cases**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "copies the full prompt|annotates, persists|edits and explicitly deletes"
```

Expected: PASS.

- [ ] **Step 3: Run the complete unit suite**

Run:

```powershell
npm run test:unit
```

Expected: all Vitest files PASS.

- [ ] **Step 4: Rebuild the single-file SDK**

Run:

```powershell
npm run build
```

Expected: exit code 0 and `prd-annotator/prd-annotator.js` contains `data-field="note"` behavior through its bundled source, while no new-editor field definitions for `acceptanceCriteria`, `dataFields`, `apiPath`, or `edgeCases` remain.

- [ ] **Step 5: Run complete browser and repository gates**

Run:

```powershell
npm run test:e2e
npm run check:repo
git diff --check
```

Expected: all Playwright tests PASS, repository policy check exits 0, and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the integration result**

```powershell
git add tests/e2e/prd-annotator.spec.js prd-annotator/prd-annotator.js
git commit -m "test: verify simplified annotation persistence"
```

- [ ] **Step 7: Confirm the worktree contains no unintended changes**

Run:

```powershell
git status --short
git log -5 --oneline
```

Expected: no uncommitted files from this plan; recent history contains the browser model, Agent gate, editor, card, and integration commits.
