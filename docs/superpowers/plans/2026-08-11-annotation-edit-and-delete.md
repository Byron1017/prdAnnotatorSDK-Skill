# PRD Annotator Annotation Edit and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-facing annotation editing and explicit, tombstone-backed deletion without weakening page isolation, permanent-data safety, PRD authorization boundaries, or display-layer removal guarantees.

**Architecture:** Extend schema-v2 page documents with backward-compatible `deletedAnnotations` tombstones. Browser and Agent merge paths use the same monotonic rule: merge active annotations, merge tombstones, then let tombstones remove matching active IDs. The Drawer owns edit/delete entry points, the controller owns mutations and cache persistence, a focused dialog module owns destructive confirmation, and all synchronization fingerprints cover tombstones while preserving legacy fingerprints when no tombstones exist.

**Tech Stack:** Vanilla JavaScript ES modules, Shadow DOM, localStorage with memory fallback, Node.js 20.11+, Vitest 3.2, jsdom 26.1, Playwright 1.55, existing Agent-side `.mjs` transaction and gate scripts.

## Global Constraints

- Keep `schemaVersion: 2`; `deletedAnnotations` is a backward-compatible extension and defaults to `[]` when absent.
- Never infer deletion from a missing annotation. Only an explicit same-page tombstone may reduce active IDs.
- Tombstones are monotonic: a matching active annotation cannot resurrect until a future explicit restore feature removes the tombstone.
- Editing preserves `id`, `createdAt`, `target`, `status`, and the complete `prd` object.
- Deleted IDs are never reused, and stable `A###` marker numbers never renumber after a middle deletion.
- Keep edit/delete UI-only; expose no delete, edit, clear, purge, reset, or restore method on `window.PRDAnnotator`.
- Annotation edit/delete and synchronization do not authorize changes to page PRDs, total PRDs, field specifications, API documents, or related source documents.
- Snapshot-verified display-layer removal preserves active annotations, tombstones, Views, PRDs, source documents, and browser cache.
- Keep the browser runtime single-file, service-free, and compatible with static HTTP and supported local-file use.
- Do not push, publish a GitHub Release, or overwrite the installed global Skill without separate user authorization.

---

### Task 1: Browser document model, tombstone merge, and fingerprints

**Files:**
- Modify: `prd-annotator/src/model.js`
- Modify: `prd-annotator/src/view-data.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Test: `tests/unit/model.test.js`
- Test: `tests/unit/model-storage.test.js`
- Test: `tests/unit/sync-status.test.js`
- Test: `tests/unit/view-data.test.js`

**Interfaces:**
- Consumes: existing `fingerprintValue(value)`, `normalizeAnnotationDocument(value, defaults)`, and `mergeAnnotationDocuments(base, incoming)`.
- Produces: `annotationFingerprintInput(document)`, `annotationDisplayNumber(annotation, fallbackIndex)`, normalized `document.deletedAnnotations`, and tombstone-aware `mergeAnnotationDocuments` for Tasks 2-5.

- [ ] **Step 1: Write failing browser-model tests**

Add these imports and focused assertions using the existing `annotation()` and `page` helpers:

```js
import {
  annotationDisplayNumber,
  annotationFingerprintInput,
  createEmptyDocument,
  mergeAnnotationDocuments,
  normalizeAnnotationDocument
} from "../../prd-annotator/src/model.js";

it("normalizes legacy documents with an empty deletion tombstone array", () => {
  const normalized = normalizeAnnotationDocument({
    ...createEmptyDocument(page),
    deletedAnnotations: undefined
  });
  expect(normalized.deletedAnnotations).toEqual([]);
});

it("lets explicit tombstones remove matching ids without treating omission as deletion", () => {
  const base = {
    ...createEmptyDocument(page),
    annotations: [
      annotation("A001", "2026-08-08T01:00:00.000Z"),
      annotation("A002", "2026-08-08T01:00:00.000Z")
    ]
  };
  const omitted = mergeAnnotationDocuments(base, createEmptyDocument(page));
  expect(omitted.annotations.map(({ id }) => id)).toEqual(["A001", "A002"]);

  const deleted = mergeAnnotationDocuments(base, {
    ...createEmptyDocument(page),
    deletedAnnotations: [{ id: "A001", deletedAt: "2026-08-08T02:00:00.000Z" }]
  });
  expect(deleted.annotations.map(({ id }) => id)).toEqual(["A002"]);
  expect(deleted.deletedAnnotations).toEqual([
    { id: "A001", deletedAt: "2026-08-08T02:00:00.000Z" }
  ]);
});

it("prevents stale annotations from resurrecting a tombstoned id", () => {
  const tombstoned = {
    ...createEmptyDocument(page),
    deletedAnnotations: [{ id: "A001", deletedAt: "2026-08-08T02:00:00.000Z" }]
  };
  const merged = mergeAnnotationDocuments(tombstoned, {
    ...createEmptyDocument(page),
    annotations: [annotation("A001", "2026-08-08T03:00:00.000Z")]
  });
  expect(merged.annotations).toEqual([]);
});

it("keeps legacy fingerprints stable until a tombstone exists", () => {
  const document = {
    ...createEmptyDocument(page),
    annotations: [annotation("A001", "2026-08-08T01:00:00.000Z")]
  };
  expect(annotationFingerprintInput(document)).toEqual(document.annotations);
  document.deletedAnnotations = [{ id: "A002", deletedAt: "2026-08-08T02:00:00.000Z" }];
  expect(annotationFingerprintInput(document)).toEqual({
    annotations: document.annotations,
    deletedAnnotations: document.deletedAnnotations
  });
});

it("derives stable display numbers from SDK ids", () => {
  expect(annotationDisplayNumber({ id: "A003" }, 0)).toBe("3");
  expect(annotationDisplayNumber({ id: "legacy-note" }, 4)).toBe("5");
});
```

Add this View assertion after importing `annotationFingerprintInput`:

```js
bundle.document.deletedAnnotations = [
  { id: "A002", deletedAt: "2026-08-11T09:00:00.000Z" }
];
bundle.persistedAnnotationFingerprint = fingerprintValue(
  annotationFingerprintInput(bundle.document)
);
expect(() => assertValidViewBundle(bundle)).not.toThrow();
bundle.persistedAnnotationFingerprint = fingerprintValue(bundle.document.annotations);
expect(() => assertValidViewBundle(bundle))
  .toThrow("persistedAnnotationFingerprint does not match annotations");
```

Add this sync-state assertion using the existing valid document fixture:

```js
const tombstoned = structuredClone(api.getSnapshot().document);
tombstoned.deletedAnnotations = [
  { id: "A099", deletedAt: "2026-08-11T09:00:00.000Z" }
];
api.hydrate({ document: tombstoned });
expect(api.getSnapshot().annotationFingerprint)
  .toBe(fingerprintValue(annotationFingerprintInput(tombstoned)));
expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
  .toBe("browser-only");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/model.test.js tests/unit/model-storage.test.js tests/unit/sync-status.test.js tests/unit/view-data.test.js
```

Expected: failures report missing `annotationFingerprintInput`, missing `annotationDisplayNumber`, absent `deletedAnnotations`, and a tombstoned ID remaining active.

- [ ] **Step 3: Implement normalization, validation, merge, and stable numbering**

Add these helpers to `prd-annotator/src/model.js`:

```js
function normalizeDeletedAnnotation(value = {}) {
  return {
    id: String(value.id || ""),
    deletedAt: String(value.deletedAt || "")
  };
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== "string"
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function annotationFingerprintInput(document = {}) {
  const annotations = clone(Array.isArray(document.annotations) ? document.annotations : []);
  const deletedAnnotations = clone(
    Array.isArray(document.deletedAnnotations) ? document.deletedAnnotations : []
  );
  return deletedAnnotations.length
    ? { annotations, deletedAnnotations }
    : annotations;
}

export function annotationDisplayNumber(annotation, fallbackIndex = 0) {
  const match = /^A(\d+)$/.exec(String(annotation?.id || ""));
  return match ? String(Number(match[1])) : String(fallbackIndex + 1);
}
```

Make both empty-document constructors emit `deletedAnnotations: []`, make normalization map `source.deletedAnnotations`, and add validation that the tombstone array contains unique non-empty IDs, valid ISO timestamps, and no ID also present in active annotations.

Replace the return construction in `mergeAnnotationDocuments` with the exact merge order below:

```js
const tombstonesById = new Map(
  normalizedBase.deletedAnnotations.map((item) => [item.id, clone(item)])
);
for (const candidate of normalizedIncoming.deletedAnnotations) {
  const current = tombstonesById.get(candidate.id);
  if (!current || Date.parse(candidate.deletedAt) >= Date.parse(current.deletedAt)) {
    tombstonesById.set(candidate.id, clone(candidate));
  }
}
for (const id of tombstonesById.keys()) annotationsById.delete(id);

return {
  schemaVersion: SCHEMA_VERSION,
  projectId: normalizedIncoming.projectId || normalizedBase.projectId,
  page: {
    ...normalizedBase.page,
    ...normalizedIncoming.page,
    id: normalizedBase.page.id
  },
  annotations: [...annotationsById.values()],
  deletedAnnotations: [...tombstonesById.values()],
  managedPrd: normalizedIncoming.managedPrd ?? normalizedBase.managedPrd
};
```

- [ ] **Step 4: Route every browser fingerprint through the shared input**

Import `annotationFingerprintInput` in `view-data.js` and `controller.js`. Replace each `fingerprintValue(documentState.annotations)` and `fingerprintValue(value.document.annotations)` call used for snapshot, prompt, sync state, or View validation with:

```js
fingerprintValue(annotationFingerprintInput(documentState))
```

or:

```js
fingerprintValue(annotationFingerprintInput(value.document))
```

Keep annotation counts based only on active `annotations.length`.

- [ ] **Step 5: Run focused and neighboring browser tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/model.test.js tests/unit/model-storage.test.js tests/unit/sync-status.test.js tests/unit/sync-prompt.test.js tests/unit/view-data.test.js tests/unit/view-loader.test.js
```

Expected: all selected tests pass; legacy no-tombstone fingerprints remain unchanged.

- [ ] **Step 6: Commit the browser data foundation**

```powershell
git add prd-annotator/src/model.js prd-annotator/src/view-data.js prd-annotator/src/runtime/controller.js tests/unit/model.test.js tests/unit/model-storage.test.js tests/unit/sync-status.test.js tests/unit/view-data.test.js tests/unit/view-loader.test.js tests/unit/sync-prompt.test.js
git commit -m "feat: add annotation deletion tombstones"
```

---

### Task 2: Drawer editing, delete confirmation, controller mutations, and stable markers

**Files:**
- Create: `prd-annotator/src/ui/delete-dialog.js`
- Modify: `prd-annotator/src/ui/editor.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/ui/overlay.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Test: `tests/unit/annotation-flow.test.js`
- Test: `tests/unit/prd-drawer.test.js`
- Test: `tests/unit/lifecycle.test.js`

**Interfaces:**
- Consumes: Task 1 `annotationDisplayNumber`, tombstone-aware document state, and fingerprint behavior.
- Produces: `renderAnnotationList(container, document, { onEdit, onDelete })`, edit-mode `openEditor`, `openDeleteDialog`, controller edit/delete handlers, and stable marker labels.

- [ ] **Step 1: Write failing edit and delete interaction tests**

Extend `tests/unit/annotation-flow.test.js` with a deterministic `now()` sequence and these observable behaviors:

First change the helper to accept controller overrides:

```js
function openAnnotationEditor(options = {}) {
  const api = createAnnotator({
    window,
    document,
    scriptSrc: "https://example.test/code/prd-annotator.js",
    explicitProjectId: "device-demo-a13f92",
    explicitPageId: "equipment-ops-7c31fa",
    ...options
  });
  api.mount();
  const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
  shadow.querySelector("[data-action='toggle-annotation']").click();
  document.querySelector("#device-list").dispatchEvent(
    new MouseEvent("click", { bubbles: true })
  );
  return { api, shadow };
}
```

```js
it("edits an annotation without changing identity, target, linkage, or creation time", () => {
  const timestamps = [
    "2026-08-11T09:00:00.000Z",
    "2026-08-11T09:05:00.000Z"
  ];
  const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });
  fillRequiredForm(shadow);
  shadow.querySelector("[data-action='save-annotation']").click();
  shadow.querySelector("[data-action='toggle-drawer']").click();

  const before = api.getSnapshot().document.annotations[0];
  shadow.querySelector("[data-action='edit-annotation'][data-annotation-id='A001']").click();
  expect(shadow.querySelector("[data-field='title']").value).toBe("Batch disable");
  shadow.querySelector("[data-field='title']").value = "Batch disable devices";
  shadow.querySelector("[data-action='save-annotation']").click();

  const after = api.getSnapshot().document.annotations[0];
  expect(after).toMatchObject({
    id: before.id,
    title: "Batch disable devices",
    createdAt: before.createdAt,
    updatedAt: "2026-08-11T09:05:00.000Z",
    target: before.target,
    status: before.status,
    prd: before.prd
  });
});

it("requires confirmation and records one tombstone for an explicit delete", () => {
  const { api, shadow } = openAnnotationEditor({
    now: () => "2026-08-11T09:10:00.000Z"
  });
  fillRequiredForm(shadow);
  shadow.querySelector("[data-action='save-annotation']").click();
  shadow.querySelector("[data-action='toggle-drawer']").click();
  shadow.querySelector("[data-action='delete-annotation'][data-annotation-id='A001']").click();

  expect(shadow.querySelector("[role='dialog']").textContent).toContain("不会自动修改 PRD");
  shadow.querySelector("[data-action='cancel-delete']").click();
  expect(api.getSnapshot().document.annotations).toHaveLength(1);

  shadow.querySelector("[data-action='delete-annotation'][data-annotation-id='A001']").click();
  shadow.querySelector("[data-action='confirm-delete']").click();
  expect(api.getSnapshot().document.annotations).toEqual([]);
  expect(api.getSnapshot().document.deletedAnnotations).toEqual([
    { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
  ]);
  expect(shadow.querySelector("[data-annotation-id='A001']")).toBeNull();
});

it("does not renumber surviving markers or reuse a deleted id", () => {
  const timestamps = [
    "2026-08-11T09:00:00.000Z",
    "2026-08-11T09:01:00.000Z",
    "2026-08-11T09:02:00.000Z",
    "2026-08-11T09:03:00.000Z",
    "2026-08-11T09:04:00.000Z"
  ];
  const { api, shadow } = openAnnotationEditor({ now: () => timestamps.shift() });

  for (const title of ["First", "Second", "Third"]) {
    fillRequiredForm(shadow, { title, description: title, prdContent: title });
    shadow.querySelector("[data-action='save-annotation']").click();
    if (title !== "Third") {
      document.querySelector("#device-list").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    }
  }

  shadow.querySelector("[data-action='toggle-drawer']").click();
  shadow.querySelector("[data-action='delete-annotation'][data-annotation-id='A002']").click();
  shadow.querySelector("[data-action='confirm-delete']").click();
  expect([...shadow.querySelectorAll(".annotation-marker")].map((node) => node.textContent))
    .toEqual(["1", "3"]);

  document.querySelector("#device-list").dispatchEvent(
    new MouseEvent("click", { bubbles: true })
  );
  fillRequiredForm(shadow, { title: "Fourth", description: "Fourth", prdContent: "Fourth" });
  shadow.querySelector("[data-action='save-annotation']").click();
  expect(api.getSnapshot().document.annotations.map(({ id }) => id))
    .toEqual(["A001", "A003", "A004"]);
});
```

Add a focused Escape assertion: opening the delete dialog and dispatching `KeyboardEvent('keydown', { key: 'Escape', bubbles: true })` cancels without mutation and restores focus to the delete button.

Add this storage-failure assertion after importing `vi` from Vitest:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});
```

```js
it("keeps a confirmed deletion in memory when localStorage writes fail", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const { api, shadow } = openAnnotationEditor({
    now: () => "2026-08-11T09:10:00.000Z"
  });
  fillRequiredForm(shadow);
  shadow.querySelector("[data-action='save-annotation']").click();
  shadow.querySelector("[data-action='toggle-drawer']").click();
  shadow.querySelector("[data-action='delete-annotation'][data-annotation-id='A001']").click();
  shadow.querySelector("[data-action='confirm-delete']").click();
  expect(api.getSnapshot().document.annotations).toEqual([]);
  expect(api.getSnapshot().document.deletedAnnotations.map(({ id }) => id))
    .toEqual(["A001"]);
  expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
    .toBe("memory-only");
});
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js tests/unit/lifecycle.test.js
```

Expected: edit/delete action selectors and dialog are absent; marker labels renumber; next ID reuses a tombstoned ID.

- [ ] **Step 3: Add edit mode to the existing editor**

Change the signature to:

```js
export function openEditor({
  container,
  target,
  initialValue = null,
  onSave,
  onCancel
})
```

Set the heading and primary action from `Boolean(initialValue)`:

```js
const isEditing = Boolean(initialValue);
heading.textContent = isEditing ? "编辑本页标注" : "添加本页标注";
saveButton.textContent = isEditing ? "保存修改" : "保存标注";
```

After each field control is created, prefill only the eight editable fields:

```js
const initialFieldValue = initialValue?.[field.name];
if (initialFieldValue !== undefined) control.value = String(initialFieldValue);
```

Keep the current required-field validation unchanged.

- [ ] **Step 4: Render card actions and stable numbers**

Change `renderAnnotationList` to accept callbacks and add action buttons with exact datasets:

```js
export function renderAnnotationList(
  container,
  annotationDocument,
  { onEdit = () => {}, onDelete = () => {} } = {}
)
```

For each card, set `item.dataset.annotationId`, render `annotationDisplayNumber(annotation, index)`, and append:

```js
const actions = container.ownerDocument.createElement("div");
actions.className = "annotation-actions";

const edit = container.ownerDocument.createElement("button");
edit.type = "button";
edit.className = "secondary-button annotation-action";
edit.dataset.action = "edit-annotation";
edit.dataset.annotationId = annotation.id;
edit.setAttribute("aria-label", `编辑标注 ${number.textContent}：${annotation.title}`);
edit.textContent = "编辑";
edit.addEventListener("click", () => onEdit(annotation.id));

const remove = container.ownerDocument.createElement("button");
remove.type = "button";
remove.className = "secondary-button annotation-action annotation-delete";
remove.dataset.action = "delete-annotation";
remove.dataset.annotationId = annotation.id;
remove.setAttribute("aria-label", `删除标注 ${number.textContent}：${annotation.title}`);
remove.textContent = "删除";
remove.addEventListener("click", () => onDelete(annotation.id));

actions.append(edit, remove);
content.append(actions);
```

Import and use the same `annotationDisplayNumber` helper in `overlay.js` instead of `String(index + 1)`.

- [ ] **Step 5: Implement the accessible delete dialog as a separate unit**

Create `prd-annotator/src/ui/delete-dialog.js` exporting:

```js
export function openDeleteDialog({
  container,
  annotation,
  displayNumber,
  onConfirm,
  onCancel
})
```

The function must replace the editor container with a `role="dialog"`, `aria-modal="true"` surface; create labelled heading `删除标注 ${displayNumber}？`; describe immediate removal, required AI synchronization, and `不会自动修改 PRD 或其他项目文档`; render `取消` with `data-action="cancel-delete"` and `确认删除` with `data-action="confirm-delete"`; focus `取消`; trap Tab/Shift+Tab between the two buttons; and invoke `onCancel` on Escape.

Use only listeners attached to nodes inside `container`, so `closeEditor(container)` removes the complete dialog and its listeners.

- [ ] **Step 6: Implement controller edit/delete mutations and focus restoration**

Add controller state `editingAnnotationId` and `returnFocus`, then make `renderAll()` pass `startEdit` and `requestDelete` into `renderAnnotationList`.

Import `openDeleteDialog` and add these handlers:

```js
function focusAnnotationAction(annotationId, action = "edit-annotation") {
  window.queueMicrotask(() => {
    const selector = annotationId
      ? `[data-action='${action}'][data-annotation-id='${annotationId}']`
      : "[data-role='annotation-list']";
    shell?.shadow?.querySelector?.(selector)?.focus();
  });
}

function startEdit(annotationId) {
  const annotation = documentState.annotations.find(({ id }) => id === annotationId);
  if (!annotation || !shell) return;
  editingAnnotationId = annotationId;
  pendingTarget = clone(annotation.target);
  returnFocus = { annotationId, action: "edit-annotation" };
  openEditor({
    container: shell.editor,
    target: pendingTarget,
    initialValue: annotation,
    onSave: savePendingAnnotation,
    onCancel: cancelCurrentEditor
  });
}

function requestDelete(annotationId) {
  const index = documentState.annotations.findIndex(({ id }) => id === annotationId);
  if (index < 0 || !shell) return;
  const annotation = documentState.annotations[index];
  const fallbackId = documentState.annotations[index + 1]?.id
    || documentState.annotations[index - 1]?.id
    || null;
  returnFocus = { annotationId, action: "delete-annotation", fallbackId };
  openDeleteDialog({
    container: shell.editor,
    annotation,
    displayNumber: annotationDisplayNumber(annotation, index),
    onConfirm: () => confirmDelete(annotationId),
    onCancel: cancelCurrentEditor
  });
}

function cancelCurrentEditor() {
  const focus = returnFocus;
  closeCurrentEditor();
  if (focus) focusAnnotationAction(focus.annotationId, focus.action);
}
```

Use the existing `shell.shadow` property consistently in `focusAnnotationAction` and its tests. `closeCurrentEditor` must reset `editingAnnotationId`, `pendingTarget`, and `returnFocus` only after callers capture the focus target.

Editing must replace only editable fields:

```js
function editableAnnotationFields(formValue) {
  return {
    title: formValue.title,
    description: formValue.description,
    type: formValue.type,
    prdContent: formValue.prdContent,
    acceptanceCriteria: formValue.acceptanceCriteria,
    dataFields: formValue.dataFields,
    apiPath: formValue.apiPath,
    edgeCases: formValue.edgeCases
  };
}
```

In `savePendingAnnotation`, branch on `editingAnnotationId`. For edit, map the active list and return `{ ...annotation, ...editableAnnotationFields(formValue), updatedAt: now() }` only for the matching ID. For create, retain the existing constructor. Both paths persist, close, rerender, and restore focus.

Delete with an exact tombstone upsert:

```js
function confirmDelete(annotationId) {
  if (!documentState.annotations.some(({ id }) => id === annotationId)) {
    closeCurrentEditor();
    renderAll();
    return;
  }
  const deletedAt = now();
  const byId = new Map(
    documentState.deletedAnnotations.map((item) => [item.id, clone(item)])
  );
  byId.set(annotationId, { id: annotationId, deletedAt });
  documentState = {
    ...documentState,
    annotations: documentState.annotations.filter(({ id }) => id !== annotationId),
    deletedAnnotations: [...byId.values()]
  };
  persistCache();
  const focus = returnFocus;
  closeCurrentEditor();
  renderAll();
  focusAnnotationAction(focus?.fallbackId || null, "edit-annotation");
}
```

Make `nextAnnotationId()` scan IDs from both `documentState.annotations` and `documentState.deletedAnnotations`. Keep the public API object unchanged.

- [ ] **Step 7: Add scoped styles and responsive behavior**

In `styles.js`, add `.annotation-actions`, `.annotation-action`, `.annotation-delete`, `.delete-dialog`, `.delete-dialog-actions`, and danger/focus-visible states. At the existing narrow-screen breakpoint, set action buttons to a minimum 44-pixel touch height and allow wrapping. Ensure the dialog and actions use `max-width: 100%` and never create horizontal overflow.

- [ ] **Step 8: Run UI, route, lifecycle, and storage tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js tests/unit/lifecycle.test.js tests/unit/model-storage.test.js tests/unit/route-switching.test.js tests/unit/tool-launcher-runtime.test.js
```

Expected: all selected tests pass; snapshots contain tombstones but the public API still has no destructive method.

- [ ] **Step 9: Commit the human-facing feature**

```powershell
git add prd-annotator/src/ui/delete-dialog.js prd-annotator/src/ui/editor.js prd-annotator/src/ui/drawer.js prd-annotator/src/ui/overlay.js prd-annotator/src/ui/styles.js prd-annotator/src/runtime/controller.js tests/unit/annotation-flow.test.js tests/unit/prd-drawer.test.js tests/unit/lifecycle.test.js
git commit -m "feat: edit and explicitly delete annotations"
```

---

### Task 3: Agent schema, synchronization merge, View fingerprints, and project gate

**Files:**
- Modify: `prd-annotator-skill/scripts/lib/schema.mjs`
- Modify: `prd-annotator-skill/scripts/lib/view.mjs`
- Modify: `prd-annotator-skill/scripts/merge-annotations.mjs`
- Modify: `prd-annotator-skill/scripts/check-project.mjs`
- Test: `tests/unit/skill-scripts.test.js`
- Test: `tests/unit/view-builder.test.js`
- Test: `tests/unit/project-gate.test.js`

**Interfaces:**
- Consumes: browser-defined tombstone shape `{ id, deletedAt }` and compatibility fingerprint rule.
- Produces: Agent-side `annotationFingerprintInput(document)`, tombstone-aware `normalizeAnnotationDocument`, canonical merge output, and gate validation for Tasks 4-6.

- [ ] **Step 1: Write failing Agent merge and gate tests**

Update the `rawSnapshot` and `promptPayload` helpers in `tests/unit/skill-scripts.test.js` to accept a `deletedAnnotations` argument and compute fingerprints with `annotationFingerprintInput(document)`.

Add tests that prove:

```js
it("deletes permanent ids only when the snapshot contains explicit tombstones", async () => {
  const projectRoot = copyFixture();
  const snapshot = rawSnapshot([], {
    document: {
      ...rawSnapshot([]).document,
      deletedAnnotations: [
        { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
      ]
    }
  });
  const merged = await mergeSnapshot({ projectRoot, snapshot });
  expect(merged.annotations).toEqual([]);
  expect(merged.deletedAnnotations).toEqual(snapshot.document.deletedAnnotations);
});

it("does not resurrect a tombstoned id from a later stale snapshot", async () => {
  const projectRoot = copyFixture();
  await mergeSnapshot({
    projectRoot,
    snapshot: rawSnapshot([], {
      document: {
        ...rawSnapshot([]).document,
        deletedAnnotations: [
          { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
        ]
      }
    })
  });
  const merged = await mergeSnapshot({
    projectRoot,
    snapshot: rawSnapshot([annotation("A001", "2026-08-11T10:00:00.000Z")])
  });
  expect(merged.annotations).toEqual([]);
  expect(merged.deletedAnnotations.map(({ id }) => id)).toEqual(["A001"]);
});
```

Add this focused gate test beside the existing malformed-annotation table:

```js
it("rejects malformed, duplicate, and overlapping deletion tombstones", () => {
  const cases = [
    [(document) => { document.deletedAnnotations = "A001"; }, "deletedAnnotations must be an array"],
    [(document) => { document.deletedAnnotations = [{ id: "", deletedAt: "2026-08-11T09:00:00.000Z" }]; }, "deleted annotation id must be a non-empty string"],
    [(document) => { document.deletedAnnotations = [{ id: "A002", deletedAt: "yesterday" }]; }, "deleted annotation A002.deletedAt must be an ISO timestamp"],
    [(document) => { document.deletedAnnotations = [{ id: "A002", deletedAt: "2026-08-11T09:00:00.000Z" }, { id: "A002", deletedAt: "2026-08-11T09:01:00.000Z" }]; }, "duplicate deleted annotation id A002"],
    [(document) => { document.deletedAnnotations = [{ id: "A001", deletedAt: "2026-08-11T09:00:00.000Z" }]; }, "annotation A001 cannot be active and deleted"]
  ];
  for (const [mutate, expected] of cases) {
    const projectRoot = copyFixture();
    const annotationPath = projectPath(projectRoot, annotationRelativePath);
    const permanent = readJson(annotationPath);
    mutate(permanent);
    writeJson(annotationPath, permanent);
    expectCheckFailure(projectRoot, expected);
  }
});
```

Add this `view-builder` assertion after importing `annotationFingerprintInput` from the Skill schema module:

```js
document.deletedAnnotations = [
  { id: "A099", deletedAt: "2026-08-11T09:00:00.000Z" }
];
const bundle = buildViewBundle({
  manifest,
  page,
  annotationDocument: document,
  documents: [],
  generatedAt: "2026-08-11T09:05:00.000Z"
});
expect(bundle.persistedAnnotationFingerprint)
  .toBe(fingerprintValue(annotationFingerprintInput(document)));
```

- [ ] **Step 2: Run Agent tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/view-builder.test.js tests/unit/project-gate.test.js
```

Expected: explicit deletion does not reduce permanent IDs; tombstones are ignored by fingerprints and validation.

- [ ] **Step 3: Add the Agent-side schema helpers**

In `lib/schema.mjs`, add the same `normalizeDeletedAnnotation` and compatibility input used by the browser:

```js
export function annotationFingerprintInput(document = {}) {
  const annotations = clone(Array.isArray(document.annotations) ? document.annotations : []);
  const deletedAnnotations = clone(
    Array.isArray(document.deletedAnnotations) ? document.deletedAnnotations : []
  );
  return deletedAnnotations.length
    ? { annotations, deletedAnnotations }
    : annotations;
}
```

Emit `deletedAnnotations: []` from `createEmptyAnnotationDocument`, normalize missing arrays to `[]`, and validate unique tombstone IDs, ISO timestamps, and no overlap with active annotations.

- [ ] **Step 4: Implement tombstone-aware snapshot fingerprints and Agent merge**

In `merge-annotations.mjs`:

- normalize both existing and incoming v2 documents before merge;
- validate prompt and raw-snapshot fingerprints with `fingerprintValue(annotationFingerprintInput(incoming))`;
- merge active annotations by strictly newer `updatedAt`, keeping the equal-time byte-conflict rule;
- merge tombstones by newest `deletedAt`;
- delete every tombstoned ID from the active map;
- retain the permanent-set gate only for IDs without a merged tombstone.

The canonical reduction proof is:

```js
const tombstoneIds = new Set(merged.deletedAnnotations.map(({ id }) => id));
for (const id of beforeIds) {
  if (!afterIds.has(id) && !tombstoneIds.has(id)) {
    fail(`${annotationPath}: merge would reduce the permanent annotation ID set without a tombstone`);
  }
}
```

Update CLI output to:

```js
`Merged ${merged.page.id}: ${incomingCount} incoming, ${incomingDeletionCount} deletions, ${merged.annotations.length} active, ${merged.deletedAnnotations.length} tombstones\n`
```

- [ ] **Step 5: Update generated View and project-gate fingerprints**

In `lib/view.mjs`, build `persistedAnnotationFingerprint` from `annotationFingerprintInput(annotationDocument)`. In `check-project.mjs`, validate optional legacy tombstones as an empty array, reject malformed tombstones, count only active annotations, and compare the View fingerprint with `fingerprintValue(annotationFingerprintInput(annotation))`.

Keep `view.document` byte-equivalent to the canonical permanent page JSON and do not render tombstones into managed PRDs.

- [ ] **Step 6: Run Agent and browser-boundary tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/view-builder.test.js tests/unit/project-gate.test.js tests/unit/view-data.test.js tests/unit/sync-prompt.test.js
```

Expected: all selected tests pass, an omitted ID is retained, an explicit tombstone deletes, and malformed tombstones fail before writing.

- [ ] **Step 7: Commit the Agent synchronization contract**

```powershell
git add prd-annotator-skill/scripts/lib/schema.mjs prd-annotator-skill/scripts/lib/view.mjs prd-annotator-skill/scripts/merge-annotations.mjs prd-annotator-skill/scripts/check-project.mjs tests/unit/skill-scripts.test.js tests/unit/view-builder.test.js tests/unit/project-gate.test.js
git commit -m "feat: synchronize explicit annotation deletions"
```

---

### Task 4: Removal, migration, backward compatibility, and Skill rules

**Files:**
- Modify: `prd-annotator-skill/scripts/remove-project.mjs`
- Modify: `prd-annotator-skill/scripts/migrate-legacy.mjs`
- Modify: `prd-annotator-skill/SKILL.md`
- Modify: `prd-annotator-skill/references/data-schema.md`
- Modify: `prd-annotator-skill/references/prd-workflow.md`
- Test: `tests/unit/project-removal.test.js`
- Test: `tests/unit/legacy-migration.test.js`
- Test: `tests/unit/project-install.test.js`
- Test: `tests/unit/skill-scripts.test.js`

**Interfaces:**
- Consumes: Task 3 canonical tombstones and `mergeSnapshot` semantics.
- Produces: deletion-aware display-removal retention, migration parity that respects tombstones, and global Skill instructions that authorize explicit annotation deletion without authorizing PRD edits.

- [ ] **Step 1: Write failing removal and migration tests**

Add these removal tests using the file's existing helpers:

```js
it("persists an explicit live tombstone before removing only the display layer", async () => {
  const projectRoot = copyFixture();
  const { manifest, page, document } = pageContext(projectRoot);
  const prdPaths = ["doc/prd/PRD.md", "doc/prd/pages/equipment-ops.md"];
  const prdBefore = new Map(
    prdPaths.map((relativePath) => [relativePath, readFileSync(projectPath(projectRoot, relativePath))])
  );
  const liveDocument = {
    ...document,
    annotations: [],
    deletedAnnotations: [
      { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
    ]
  };

  await removeProject({
    projectRoot,
    pageIds: [page.id],
    snapshots: [rawSnapshot(manifest, liveDocument)],
    confirmRemove: true,
    now: fixedNow
  });

  const permanent = readJson(projectPath(projectRoot, page.annotationFile));
  expect(permanent.annotations).toEqual([]);
  expect(permanent.deletedAnnotations).toEqual(liveDocument.deletedAnnotations);
  expect(inspectIntegration(readFileSync(projectPath(projectRoot, page.htmlPath), "utf8")))
    .toHaveLength(0);
  for (const [relativePath, bytes] of prdBefore) {
    expect(readFileSync(projectPath(projectRoot, relativePath))).toEqual(bytes);
  }
});

it("does not infer deletion from a live snapshot omission during removal", async () => {
  const projectRoot = copyFixture();
  const { manifest, page, document } = pageContext(projectRoot);
  await removeProject({
    projectRoot,
    pageIds: [page.id],
    snapshots: [rawSnapshot(manifest, { ...document, annotations: [] })],
    confirmRemove: true,
    now: fixedNow
  });
  expect(readJson(projectPath(projectRoot, page.annotationFile)).annotations.map(({ id }) => id))
    .toEqual(["A001"]);
});
```

Add this migration test using `seedLegacy`, `projectPath`, `readJson`, and `writeJson` already defined in the file:

```js
it("does not resurrect a legacy id represented by a canonical tombstone", async () => {
  const projectRoot = await seedLegacy({ keepV2: true });
  const manifest = await readJson(projectPath(projectRoot, v2ManifestRelativePath));
  const page = manifest.pages[0];
  const canonicalPath = projectPath(projectRoot, page.annotationFile);
  const canonical = await readJson(canonicalPath);
  canonical.annotations = [];
  canonical.deletedAnnotations = [
    { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
  ];
  await writeJson(canonicalPath, canonical);

  await migrateLegacy({
    projectRoot,
    authorization: "upgrade",
    confirmMigration: true,
    now
  });

  const migrated = await readJson(canonicalPath);
  expect(migrated.annotations.map(({ id }) => id)).toEqual(["A002"]);
  expect(migrated.deletedAnnotations.map(({ id }) => id)).toEqual(["A001"]);
});
```

Add this backward-compatibility test to `skill-scripts.test.js`:

```js
it("refreshes and gates legacy v2 page JSON without a tombstone field", async () => {
  const projectRoot = copyFixture();
  const permanent = readJson(annotationPath(projectRoot));
  delete permanent.deletedAnnotations;
  writeJson(annotationPath(projectRoot), permanent);
  await refreshProject({ projectRoot, now: new Date("2026-08-11T09:20:00.000Z") });
  await expect(checkProject({ projectRoot }))
    .resolves.toMatchObject({ pages: 1, annotations: 1 });
});
```

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js tests/unit/project-install.test.js tests/unit/skill-scripts.test.js
```

Expected: removal reports a permanent annotation was lost, migration parity reports a missing legacy ID, or legacy no-tombstone validation fails.

- [ ] **Step 3: Make snapshot-verified removal understand explicit tombstones**

In `assertSnapshotRetention`, create maps for `live.deletedAnnotations` and `permanent.deletedAnnotations`. An original active ID may be absent from permanent active data only when the live and permanent documents both contain that ID's tombstone. Every live tombstone must exist permanently with an equal-or-newer `deletedAt`.

Use this exact decision for each original ID:

```js
if (!retained) {
  const liveDeletion = liveDeletedById.get(id);
  const permanentDeletion = permanentDeletedById.get(id);
  if (!liveDeletion || !permanentDeletion) {
    fail(`${annotationPath}: permanent annotation ${id} was lost without an explicit deletion`);
  }
  if (Date.parse(permanentDeletion.deletedAt) < Date.parse(liveDeletion.deletedAt)) {
    fail(`${annotationPath}: live deletion ${id} is newer than permanent JSON`);
  }
  continue;
}
```

Do not let the removal operation itself create tombstones.

- [ ] **Step 4: Prevent legacy migration from resurrecting deleted IDs**

Normalize existing and legacy page documents in `mergeUpgradeAnnotations`. Build a tombstone ID set from the existing canonical document. Skip a legacy active annotation when its ID is tombstoned. Update parity verification so every legacy ID must exist in either the canonical active set or canonical tombstone set.

Keep legacy sources byte-for-byte unchanged.

- [ ] **Step 5: Update the global Skill contract and data schema**

In `SKILL.md`, add explicit annotation edit/delete intent to the control flow and state:

```text
Treat a browser tombstone as explicit authorization to remove only the matching active annotation from the same page JSON during synchronization. Never infer deletion from omission, an empty snapshot, display-layer removal, or a missing DOM target. Annotation edit or deletion does not authorize editing any PRD or related document.
```

In `references/data-schema.md`, add the `deletedAnnotations` example, validation rules, compatibility fingerprint rule, and revised invariant: preserve permanent-only IDs unless an explicit same-page tombstone exists.

In `references/prd-workflow.md`, document that synchronization persists tombstones and may reduce only matching active IDs; removal preserves tombstones and never invents them; PRD changes still require separate user intent.

- [ ] **Step 6: Run lifecycle and Skill-source tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js tests/unit/project-install.test.js tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
```

Expected: all selected tests pass; old projects remain readable; explicit deletion and display-layer removal remain distinct.

- [ ] **Step 7: Commit workflow safety and documentation**

```powershell
git add prd-annotator-skill/scripts/remove-project.mjs prd-annotator-skill/scripts/migrate-legacy.mjs prd-annotator-skill/SKILL.md prd-annotator-skill/references/data-schema.md prd-annotator-skill/references/prd-workflow.md tests/unit/project-removal.test.js tests/unit/legacy-migration.test.js tests/unit/project-install.test.js tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
git commit -m "feat: preserve deletion intent across workflows"
```

---

### Task 5: Browser E2E coverage, version 2.3.0, and local release artifacts

**Files:**
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `tests/unit/release-package.test.js`
- Modify: `prd-annotator/src/constants.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/route-and-document-workflow.md`
- Regenerate: `prd-annotator/prd-annotator.js`
- Regenerate: `dist/release/prd-annotator.js`
- Regenerate: `dist/release/prd-annotator.js.sha256`
- Regenerate: `dist/release/release-manifest.json`

**Interfaces:**
- Consumes: complete Tasks 1-4 browser and Agent behavior.
- Produces: verified SDK version `2.3.0`, a user-visible browser regression test, and checksum-ready local Release assets. It does not publish them.

- [ ] **Step 1: Write the failing Playwright journey**

Add helper functions `editAnnotation(page, id, title)` and `deleteAnnotation(page, id, { confirm })` using the new datasets. Add one E2E test named exactly:

```js
async function editAnnotation(page, id, title) {
  const host = await openDrawer(page);
  await host.locator(`[data-action='edit-annotation'][data-annotation-id='${id}']`).click();
  await host.locator("[data-field='title']").fill(title);
  await host.locator("[data-action='save-annotation']").click();
}

async function deleteAnnotation(page, id, { confirm }) {
  const host = await openDrawer(page);
  await host.locator(`[data-action='delete-annotation'][data-annotation-id='${id}']`).click();
  await host.locator(
    confirm ? "[data-action='confirm-delete']" : "[data-action='cancel-delete']"
  ).click();
}
```

Add one E2E test named exactly:

```js
test("edits and explicitly deletes annotations without renumbering", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  await page.evaluate(() => window.PRDAnnotatorReady);
  await createAnnotation(page, "First");
  await createAnnotation(page, "Second");
  await createAnnotation(page, "Third");

  const host = await openDrawer(page);
  await editAnnotation(page, "A002", "Second edited");
  await expect(host.locator("[data-annotation-id='A002']")).toContainText("Second edited");

  await deleteAnnotation(page, "A002", { confirm: false });
  await expect(host.locator("[data-annotation-id='A002']")).toHaveCount(1);
  await deleteAnnotation(page, "A002", { confirm: true });
  await expect(host.locator("[data-annotation-id='A002']")).toHaveCount(0);
  await expect(host.locator(".annotation-number")).toHaveText(["1", "3"]);
  await expect(host.locator(".annotation-marker")).toHaveText(["1", "3"]);

  const snapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(snapshot.document.annotations.map(({ id }) => id)).toEqual(["A001", "A003"]);
  expect(snapshot.document.deletedAnnotations).toEqual([
    { id: "A002", deletedAt: expect.any(String) }
  ]);
  expect(snapshot.annotationFingerprint).not.toBe(snapshot.persistedAnnotationFingerprint);

  await page.reload();
  await page.evaluate(() => window.PRDAnnotatorReady);
  const afterReload = await page.evaluate(() => window.PRDAnnotator.getSnapshot().document);
  expect(afterReload.annotations.map(({ id }) => id)).toEqual(["A001", "A003"]);
  expect(afterReload.deletedAnnotations.map(({ id }) => id)).toEqual(["A002"]);
});
```

Extend the existing Hash-route isolation test after returning to `message-edit`:

```js
await deleteAnnotation(page, "A001", { confirm: true });
expect(await page.evaluate(() => window.PRDAnnotator.getSnapshot().document.deletedAnnotations.map(({ id }) => id)))
  .toEqual(["A001"]);
await page.evaluate(() => { window.location.hash = "#/message/list"; });
await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
  .toBe("message-list");
expect(await page.evaluate(() => window.PRDAnnotator.getSnapshot().document.deletedAnnotations))
  .toEqual([]);
```

Extend the existing physical-page isolation test after its final Drawer assertion:

```js
await deleteAnnotation(page, "A001", { confirm: true });
expect(await page.evaluate(() => window.PRDAnnotator.getSnapshot().document.deletedAnnotations.map(({ id }) => id)))
  .toEqual(["A001"]);
await page.goto("/examples/device-ops/second-page.html");
expect(await page.evaluate(() => window.PRDAnnotator.getSnapshot().document.deletedAnnotations))
  .toEqual([]);
```

- [ ] **Step 2: Build the current SDK and verify the E2E test is RED**

Run:

```powershell
npm run build
npx playwright test -g "edits and explicitly deletes annotations without renumbering"
```

Expected: the new journey fails before Tasks 1-4 are present, or passes here only after their verified implementation; retain the earlier Task 2 unit RED evidence as the required behavior proof.

- [ ] **Step 3: Bump the feature release to 2.3.0 and update public documentation**

Set `package.json` and lockfile version to `2.3.0`; set `SDK_VERSION = "2.3.0"`; update README capabilities to include per-card edit/delete, explicit tombstones, stable numbering, and the separate PRD authorization rule. Update the workflow document with the user sequence: edit/delete in Drawer, copy/send synchronization prompt, Agent merge/refresh/gate, then separately request PRD changes when desired.

Extend `release-package.test.js` to require the new version banner, `deletedAnnotations`, `edit-annotation`, `delete-annotation`, and `confirm-delete`, while continuing to reject public destructive API methods and network save services.

- [ ] **Step 4: Rebuild and run the focused browser journey**

Run:

```powershell
npm run build
npx playwright test -g "edits and explicitly deletes annotations without renumbering"
```

Expected: 1 passed, with no page errors, console errors, horizontal overflow, or marker renumbering.

- [ ] **Step 5: Package local Release assets and verify checksums**

Run:

```powershell
npm run release:package
$declared = (Get-Content -Raw 'dist/release/prd-annotator.js.sha256').Trim()
$actual = (Get-FileHash -Algorithm SHA256 'dist/release/prd-annotator.js').Hash.ToLowerInvariant()
if ($declared -ne $actual) { throw "Release checksum mismatch" }
```

Expected: `release-manifest.json` reports `2.3.0`; declared and actual SHA-256 values are identical.

- [ ] **Step 6: Commit the release-ready implementation**

```powershell
git add tests/e2e/prd-annotator.spec.js tests/unit/release-package.test.js prd-annotator/src/constants.js package.json package-lock.json README.md docs/route-and-document-workflow.md prd-annotator/prd-annotator.js
git commit -m "release: prepare annotation editing 2.3.0"
```

Do not add ignored `dist/` files to Git unless repository policy already tracks them.

---

### Task 6: Full regression, policy gates, and handoff

**Files:**
- Verify: entire repository
- Verify: `tests/fixtures/project`
- Verify: `dist/release/*`

**Interfaces:**
- Consumes: all implementation commits from Tasks 1-5.
- Produces: evidence-backed completion report and a clean local `master`; external push, Release publication, and global Skill installation remain separately authorized actions.

- [ ] **Step 1: Run the complete unit, build, and Playwright suite**

Run:

```powershell
npm test
```

Expected: every unit test and every Playwright test passes; only the two existing permission-dependent unit skips are allowed.

- [ ] **Step 2: Run repository and installed-project-compatible gates**

Run:

```powershell
npm run check:repo
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
npm run release:package
```

Expected: repository policy passes, fixture project gate passes, and Release packaging succeeds.

- [ ] **Step 3: Audit the exact requirement surface**

Run:

```powershell
rg -n "deletedAnnotations|edit-annotation|delete-annotation|confirm-delete|annotationFingerprintInput" prd-annotator prd-annotator-skill tests README.md docs/route-and-document-workflow.md
rg -n "deleteAnnotation|clearAnnotations|purgeAnnotations|resetAnnotations" prd-annotator/src
git diff --check
git status --short --branch
```

Expected: all five required internal concepts appear in implementation and tests; no public destructive API method is introduced; diff check is empty; branch status shows only intentional commits and no uncommitted files.

- [ ] **Step 4: Report completion and request separate distribution authorization**

Report:

- commit hashes for each task;
- unit and E2E pass counts;
- repository, fixture, and release-package gate results;
- local Release version and SHA-256;
- the exact global Skill source directory changed in the repository;
- confirmation that no GitHub push, Release upload, or installed Skill overwrite occurred.

Ask the user whether to push `master`, publish `v2.3.0`, and update `C:\Users\28920\.agents\skills\prd-annotator` with UTF-8 BOM Markdown files.
