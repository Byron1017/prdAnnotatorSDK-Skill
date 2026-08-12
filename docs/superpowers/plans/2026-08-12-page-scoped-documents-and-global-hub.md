# Page-scoped Documents and Global Document Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page PRDs, Field specifications, and API documents follow the current logical page, while the final `关联文档` Tab provides a four-card project-wide document hub with separate global and unassigned-candidate details.

**Architecture:** Keep document type (`kind`) separate from ownership (`scope`) under schema version 2. Normalize historical entries through one shared document-scope contract, write explicit scope during authorized inventory refresh, include only current-page page documents plus global/unassigned hub documents in each View, and render those categories through focused page panels and a read-only two-level hub. Do not touch annotation data or turn synchronization into document authorization.

**Tech Stack:** JavaScript ES modules, Node.js 20.11+, Vitest 3.2.4, jsdom, esbuild single-file SDK build, Playwright 1.55.0.

## Global Constraints

- Continue using `schemaVersion: 2`; add only optional document `scope` with values `page`, `global`, or `unassigned`.
- `scope: page` requires a non-empty `pageIds` array containing valid Manifest logical-page IDs.
- `scope: global` and `scope: unassigned` require `pageIds: []`.
- Historical scope inference is exact: non-empty `pageIds` → `page`; empty `total-prd`, `public`, or `public-rule` → `global`; empty `field-spec`, `api-doc`, `page-prd`, `requirement`, `other`, or `unclassified` → `unassigned`.
- Never infer page ownership from the current page, directory proximity, filename similarity, live Hash parameters, numeric path segments, or query values.
- Preserve existing identity isolation for 多 HTML projects, registered Hash routes, dynamic/query parameters, direct deep links, ordinary anchors, and legacy route data.
- A View must never contain a `scope: page` document belonging only to another logical page.
- The fixed top-level Tab order is `本页标注`, `页面 PRD`, `页面字段规范`, `页面接口文档`, `关联文档`.
- `页面 PRD` exposes the immediately visible secondary switch `页面 PRD` / `本页补充资料 <count>` above long content.
- `关联文档` is the final Tab and opens with exactly four cards: `总需求文档`, `总 PRD 文档`, `总字段规范`, `总接口文档`.
- Every hub detail separates `全局文档` from `待关联候选`; page-scoped documents never enter the hub and unassigned candidates never render as global.
- Installation, annotation creation/edit/delete/synchronization, route registration, and View refresh never authorize source-document creation or edits.
- Preserve annotation fields, JSON, storage, merge, tombstones, fingerprints, route/page identity, and schema behavior byte-for-byte except regenerated SDK/View output that necessarily changes.
- Keep tracked filenames and paths ASCII-only and text UTF-8 without BOM.

---

## File Structure

### New focused modules

- `prd-annotator-skill/scripts/lib/document-scope.mjs`: one canonical Agent-side scope normalizer, kind/scope validator, and View-inclusion predicate.
- `prd-annotator/src/document-scope.js`: browser-side validation and presentation helpers for already-normalized View entries; intentionally independent of Node APIs.
- `prd-annotator/src/ui/page-documents.js`: page PRD secondary switch, page document filtering, counts, empty states, and reset behavior.
- `prd-annotator/src/ui/document-hub.js`: four-card hub, category detail view, separated global/candidate sections, return navigation, and counts.
- `tests/unit/document-scope.test.js`: pure browser helper contract.
- `tests/unit/document-hub.test.js`: hub interaction and category rendering.

### Existing files modified

- Agent data flow: `prd-annotator-skill/scripts/lib/schema.mjs`, `lib/documents.mjs`, `lib/view.mjs`, `check-project.mjs`, `generate-prd.mjs`, `migrate-legacy.mjs`.
- Browser validation/runtime: `prd-annotator/src/view-data.js`, `runtime/controller.js`, `ui/shell.js`, `ui/styles.js`, `ui/drawer.js`, generated `prd-annotator/prd-annotator.js`.
- Skill rules: `prd-annotator-skill/SKILL.md`, `references/data-schema.md`, `references/prd-workflow.md`, `references/document-writing.md`, `references/field-spec.md`, `references/api-document.md`.
- Public docs: `README.md`, `docs/route-and-document-workflow.md`.
- Tests: document discovery, View builder, project gate, managed PRD, legacy migration, Drawer Tabs, PRD Drawer, route switching, Skill contracts, E2E, and release packaging.

---

### Task 1: Canonical document-scope contract and historical normalization

**Files:**
- Create: `prd-annotator-skill/scripts/lib/document-scope.mjs`
- Create: `tests/unit/document-scope-agent.test.js`
- Modify: `prd-annotator-skill/scripts/lib/schema.mjs`
- Modify: `prd-annotator-skill/scripts/lib/documents.mjs`
- Modify: `prd-annotator-skill/scripts/generate-prd.mjs`
- Modify: `prd-annotator-skill/scripts/migrate-legacy.mjs`
- Test: `tests/unit/document-discovery.test.js`
- Test: `tests/unit/managed-prd.test.js`
- Test: `tests/unit/legacy-migration.test.js`

**Interfaces:**
- Produces: `DOCUMENT_SCOPES`, `inferDocumentScope(entry)`, `normalizeDocumentScope(entry)`, `validateDocumentScope(entry, knownPageIds?)`, and `documentBelongsToPage(entry, pageId)`.
- `normalizeDocumentScope(entry)` returns a cloned entry with explicit `scope` and preserved `pageIds`; it never mutates input.
- Later tasks import this module from View building and project gates.

- [ ] **Step 1: Write the failing pure scope-contract tests**

Create `tests/unit/document-scope-agent.test.js` with table-driven tests:

```js
import { describe, expect, it } from "vitest";
import {
  documentBelongsToPage,
  inferDocumentScope,
  normalizeDocumentScope,
  validateDocumentScope
} from "../../prd-annotator-skill/scripts/lib/document-scope.mjs";

describe("Agent document scope", () => {
  it.each([
    [{ kind: "field-spec", pageIds: ["message-a13f92"] }, "page"],
    [{ kind: "api-doc", pageIds: ["message-a13f92"] }, "page"],
    [{ kind: "total-prd", pageIds: [] }, "global"],
    [{ kind: "public-rule", pageIds: [] }, "global"],
    [{ kind: "field-spec", pageIds: [] }, "unassigned"],
    [{ kind: "api-doc", pageIds: [] }, "unassigned"],
    [{ kind: "page-prd", pageIds: [] }, "unassigned"],
    [{ kind: "unclassified", pageIds: [] }, "unassigned"]
  ])("infers historical %j as %s", (entry, expected) => {
    expect(inferDocumentScope(entry)).toBe(expected);
    expect(normalizeDocumentScope(entry)).toEqual({ ...entry, scope: expected });
  });

  it.each([
    [{ kind: "field-spec", scope: "page", pageIds: [] }, "page scope requires pageIds"],
    [{ kind: "api-doc", scope: "global", pageIds: ["message-a13f92"] }, "global scope requires empty pageIds"],
    [{ kind: "page-prd", scope: "global", pageIds: [] }, "page-prd cannot be global"],
    [{ kind: "total-prd", scope: "unassigned", pageIds: [] }, "total-prd must be global"],
    [{ kind: "unclassified", scope: "global", pageIds: [] }, "unclassified must be unassigned"]
  ])("rejects %j", (entry, message) => {
    expect(() => validateDocumentScope(entry, new Set(["message-a13f92"])))
      .toThrow(message);
  });

  it("matches only explicit current-page scope", () => {
    const entry = { kind: "field-spec", scope: "page", pageIds: ["page-a"] };
    expect(documentBelongsToPage(entry, "page-a")).toBe(true);
    expect(documentBelongsToPage(entry, "page-b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the scope tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/document-scope-agent.test.js
```

Expected: FAIL because `document-scope.mjs` does not exist.

- [ ] **Step 3: Implement the minimal canonical scope helper**

Create `document-scope.mjs` with exact exports and deterministic errors:

```js
export const DOCUMENT_SCOPES = new Set(["page", "global", "unassigned"]);
const GLOBAL_ONLY_KINDS = new Set(["total-prd", "public", "public-rule"]);

export function inferDocumentScope(entry = {}) {
  if (DOCUMENT_SCOPES.has(entry.scope)) return entry.scope;
  if (Array.isArray(entry.pageIds) && entry.pageIds.length) return "page";
  if (GLOBAL_ONLY_KINDS.has(entry.kind)) return "global";
  return "unassigned";
}

export function normalizeDocumentScope(entry = {}) {
  return { ...entry, scope: inferDocumentScope(entry) };
}

export function validateDocumentScope(entry, knownPageIds) {
  const scope = inferDocumentScope(entry);
  const pageIds = Array.isArray(entry.pageIds) ? entry.pageIds : [];
  if (scope === "page" && !pageIds.length) throw new Error("page scope requires pageIds");
  if (scope !== "page" && pageIds.length) throw new Error(`${scope} scope requires empty pageIds`);
  if (entry.kind === "page-prd" && scope === "global") throw new Error("page-prd cannot be global");
  if (GLOBAL_ONLY_KINDS.has(entry.kind) && scope !== "global") throw new Error(`${entry.kind} must be global`);
  if (entry.kind === "unclassified" && scope !== "unassigned") throw new Error("unclassified must be unassigned");
  if (knownPageIds) {
    for (const pageId of pageIds) if (!knownPageIds.has(pageId)) throw new Error(`unknown pageId: ${pageId}`);
  }
  return scope;
}

export function documentBelongsToPage(entry, pageId) {
  return inferDocumentScope(entry) === "page" && entry.pageIds?.includes(pageId) === true;
}
```

- [ ] **Step 4: Make discovery write explicit scope without inventing ownership**

In `documents.mjs`, normalize every existing/discovered entry. A discovered `field-spec`, `api-doc`, ambiguous `page-prd`, `requirement`, `other`, or `unclassified` with no manual mapping must receive `scope: "unassigned"`. Preserve manual scope/page mappings. Missing retained entries must retain or infer explicit scope.

Update discovery tests to assert:

```js
expect(fieldEntry).toMatchObject({ kind: "field-spec", scope: "unassigned", pageIds: [] });
expect(apiEntry).toMatchObject({ kind: "api-doc", scope: "unassigned", pageIds: [] });
expect(manualPageEntry).toMatchObject({ scope: "page", pageIds: ["equipment-ops-7c31fa"] });
expect(totalPrdEntry).toMatchObject({ kind: "total-prd", scope: "global", pageIds: [] });
```

Update `validateManifestV2` in `lib/schema.mjs` so historical entries may omit `scope`, explicit values must be one of the three allowed scopes, and normalized scope/page/kind combinations are validated before any mutating orchestrator proceeds. Keep the stricter “generated Views must contain explicit scope” rule in Task 2.

- [ ] **Step 5: Add explicit scope to managed and migrated PRDs**

In `generate-prd.mjs`, `updateManagedDocument` writes:

```js
scope: kind === "total-prd" ? "global" : "page"
```

In `migrate-legacy.mjs`, migrated page PRDs use `scope: "page"`; migrated total PRDs use `scope: "global"`. Update managed/migration tests to assert these exact fields without changing generated document content.

- [ ] **Step 6: Run Task 1 tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/document-scope-agent.test.js tests/unit/document-discovery.test.js tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js
```

Expected: all selected test files pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add prd-annotator-skill/scripts/lib/document-scope.mjs prd-annotator-skill/scripts/lib/schema.mjs prd-annotator-skill/scripts/lib/documents.mjs prd-annotator-skill/scripts/generate-prd.mjs prd-annotator-skill/scripts/migrate-legacy.mjs tests/unit/document-scope-agent.test.js tests/unit/document-discovery.test.js tests/unit/managed-prd.test.js tests/unit/legacy-migration.test.js
git commit -m "feat: add document scope contract"
```

---

### Task 2: Scope-aware View selection and project gate

**Files:**
- Modify: `prd-annotator-skill/scripts/lib/view.mjs`
- Modify: `prd-annotator-skill/scripts/check-project.mjs`
- Modify: `prd-annotator/src/view-data.js`
- Create: `prd-annotator/src/document-scope.js`
- Create: `tests/unit/document-scope.test.js`
- Test: `tests/unit/view-builder.test.js`
- Test: `tests/unit/project-gate.test.js`
- Test: `tests/unit/view-data.test.js`

**Interfaces:**
- Consumes Agent helpers from Task 1.
- Produces browser helpers `DOCUMENT_SCOPES`, `scopeOfDocument(entry)`, `assertDocumentScope(entry)`, `isCurrentPageDocument(entry, pageId)`, and `hubCategoryForDocument(entry)`.
- Every generated View document has explicit `scope`.

- [ ] **Step 1: Write failing View isolation tests**

Extend `view-builder.test.js` with two manifest pages and documents:

```js
const documents = [
  inventory({ id: "fields-a", kind: "field-spec", scope: "page", pageIds: [pageA.id] }),
  inventory({ id: "api-b", kind: "api-doc", scope: "page", pageIds: [pageB.id] }),
  inventory({ id: "fields-global", kind: "field-spec", scope: "global", pageIds: [] }),
  inventory({ id: "api-candidate", kind: "api-doc", scope: "unassigned", pageIds: [] })
];

expect(build(pageA, documents).documents.map(({ id, scope }) => [id, scope]))
  .toEqual([
    ["fields-a", "page"],
    ["fields-global", "global"],
    ["api-candidate", "unassigned"]
  ]);
expect(build(pageA, documents).documents.map((entry) => entry.id)).not.toContain("api-b");
```

Add browser validation tests that reject `page` with empty `pageIds`, `global` with page IDs, illegal kind/scope pairs, and missing explicit View scope.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/view-builder.test.js tests/unit/view-data.test.js -t "scope|other-page|global hub"
```

Expected: FAIL because View entries do not carry/validate scope and selection still includes every unbound Field/API document.

- [ ] **Step 3: Implement browser scope helpers**

Create `prd-annotator/src/document-scope.js` with the browser equivalent of Task 1 validation plus category mapping:

```js
export const DOCUMENT_SCOPES = new Set(["page", "global", "unassigned"]);

export function scopeOfDocument(entry) {
  return entry.scope;
}

export function isCurrentPageDocument(entry, pageId) {
  return entry.scope === "page" && entry.pageIds.includes(pageId);
}

export function hubCategoryForDocument(entry) {
  if (entry.kind === "total-prd" || entry.kind === "page-prd") return "prd";
  if (entry.kind === "field-spec") return "field";
  if (entry.kind === "api-doc") return "api";
  return "requirement";
}
```

`assertDocumentScope` must enforce the same kind/scope matrix as Task 1 and return the validated entry. Use it from `view-data.js`; View data must contain explicit `scope` even while Manifest reads remain historically compatible.

- [ ] **Step 4: Make View selection scope-aware**

In `lib/view.mjs`:

```js
const selected = documents.filter((entry) =>
  documentBelongsToPage(entry, page.id)
  || inferDocumentScope(entry) === "global"
  || inferDocumentScope(entry) === "unassigned"
);
```

Sort selected entries deterministically by scope (`page`, `global`, `unassigned`), then path and ID. `viewDocument` writes normalized `scope`. Remove the old special case that globalized every Field/API document and unassociated page PRD.

- [ ] **Step 5: Make the complete project gate enforce scope and exact View membership**

In `check-project.mjs`:

- normalize historical Manifest scope before comparison;
- validate scope/page/kind combinations with all known page IDs;
- require View scope to equal normalized Manifest scope;
- replace `expectedViewDocuments` with the same selection/order rule as `buildViewBundle`;
- include `scope` in stale-inventory comparison;
- assert managed page PRDs are `page` and managed total PRDs are `global`.

Add project-gate cases for invalid scope strings, page/global page ID mismatches, illegal kind/scope pairs, stale View scope, and another-page leakage.

- [ ] **Step 6: Run Task 2 tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/document-scope.test.js tests/unit/view-builder.test.js tests/unit/view-data.test.js tests/unit/project-gate.test.js
```

Expected: all selected test files pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add prd-annotator/src/document-scope.js prd-annotator/src/view-data.js prd-annotator-skill/scripts/lib/view.mjs prd-annotator-skill/scripts/check-project.mjs tests/unit/document-scope.test.js tests/unit/view-builder.test.js tests/unit/view-data.test.js tests/unit/project-gate.test.js
git commit -m "feat: isolate document views by scope"
```

---

### Task 3: Top-level Tab order and page-document panels

**Files:**
- Create: `prd-annotator/src/ui/page-documents.js`
- Modify: `prd-annotator/src/ui/shell.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `prd-annotator/src/ui/drawer.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Test: `tests/unit/drawer-tabs.test.js`
- Test: `tests/unit/prd-drawer.test.js`
- Test: `tests/unit/route-switching.test.js`

**Interfaces:**
- Consumes `isCurrentPageDocument(entry, pageId)` from Task 2.
- Produces `createPageDocumentController({ root, prdContainer, supplementContainer })` with methods `render({ documents, pageId, managedMarkdown })`, `select(id)`, and `reset()`.
- Top-level `createTabController` remains unchanged and still resets to `annotations` on logical-page change.

- [ ] **Step 1: Write failing Tab-order and page-filter tests**

Update `drawer-tabs.test.js` to assert exact labels/order:

```js
expect([...shell.tabs].map((tab) => [tab.dataset.tab, tab.textContent.trim()]))
  .toEqual([
    ["annotations", "本页标注 0"],
    ["page-prd", "页面 PRD"],
    ["field-spec", "页面字段规范"],
    ["api-doc", "页面接口文档"],
    ["related", "关联文档"]
  ]);
```

Replace the old “renders field and API documents into every declared tab” test with page-scoped fixtures. Assert that page A panels include only documents with `scope: page` and `pageIds` containing page A, and exclude global/unassigned/other-page documents.

- [ ] **Step 2: Write failing page PRD secondary-switch tests**

Add a long page PRD plus page-linked requirement/flow documents. Assert:

```js
const switcher = shadow.querySelector("[data-role='page-prd-switcher']");
expect(switcher.compareDocumentPosition(shadow.querySelector("[data-role='prd-content']"))
  & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(switcher.textContent).toContain("页面 PRD");
expect(switcher.textContent).toContain("本页补充资料 2");
shadow.querySelector("[data-page-doc-view='supplements']").click();
expect(shadow.querySelector("[data-page-doc-panel='supplements']").hidden).toBe(false);
expect(shadow.querySelector("[data-page-doc-panel='prd']").hidden).toBe(true);
```

Add a zero-supplement case and route-change reset case.

- [ ] **Step 3: Run page UI tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/route-switching.test.js -t "Tab|page document|supplement|route"
```

Expected: FAIL because labels/order, secondary switch, and scope filtering do not exist.

- [ ] **Step 4: Update shell markup with exact page-first order**

Move `关联文档` after API. Rename labels to `页面字段规范` and `页面接口文档`. Inside the page PRD panel place this structure before any content:

```html
<div class="page-document-switcher" data-role="page-prd-switcher" role="tablist" aria-label="页面 PRD 资料">
  <button type="button" role="tab" data-page-doc-view="prd" aria-selected="true">页面 PRD</button>
  <button type="button" role="tab" data-page-doc-view="supplements" aria-selected="false">本页补充资料 <span data-role="supplement-count">0</span></button>
</div>
<div data-page-doc-panel="prd">
  <div data-role="prd-content"></div>
  <div data-role="document-page-prd"></div>
</div>
<div data-page-doc-panel="supplements" hidden>
  <div data-role="document-page-supplements"></div>
</div>
```

- [ ] **Step 5: Implement page document controller and scope filtering**

`page-documents.js` filters:

```js
const current = documents.filter((entry) => isCurrentPageDocument(entry, pageId));
const pagePrds = current.filter((entry) => entry.kind === "page-prd");
const fields = current.filter((entry) => entry.kind === "field-spec");
const apis = current.filter((entry) => entry.kind === "api-doc");
const supplements = current.filter((entry) => !["page-prd", "field-spec", "api-doc"].includes(entry.kind));
```

Render page PRDs, fields, APIs, and supplements only into their own containers. Update count before rendering. `reset()` selects `prd`, hides supplements, restores ARIA selection, and is called during logical-page activation.

Remove scope/category routing from the old `renderDocumentsByGroup`; keep shared `appendDocumentCard` exported for both focused UI modules.

- [ ] **Step 6: Add stable sticky secondary-switch styling**

Add focused styles:

```css
.page-document-switcher {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  gap: 8px;
  padding: 12px 0;
  background: var(--prd-color-surface);
}

.page-document-switcher button {
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
}
```

Preserve top-level sticky/horizontal Tab behavior and focus-visible rules.

- [ ] **Step 7: Run Task 3 tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/route-switching.test.js
```

Expected: all selected test files pass.

- [ ] **Step 8: Commit Task 3**

```powershell
git add prd-annotator/src/ui/page-documents.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/styles.js prd-annotator/src/ui/drawer.js prd-annotator/src/runtime/controller.js tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/route-switching.test.js
git commit -m "feat: add page-scoped document panels"
```

---

### Task 4: Four-card global document hub

**Files:**
- Create: `prd-annotator/src/ui/document-hub.js`
- Create: `tests/unit/document-hub.test.js`
- Modify: `prd-annotator/src/ui/shell.js`
- Modify: `prd-annotator/src/ui/styles.js`
- Modify: `prd-annotator/src/runtime/controller.js`
- Test: `tests/unit/prd-drawer.test.js`
- Test: `tests/unit/route-switching.test.js`

**Interfaces:**
- Consumes `hubCategoryForDocument(entry)` and shared `appendDocumentCard`.
- Produces `createDocumentHub({ root })` with `render(documents)`, `open(categoryId)`, and `reset()`.
- Category IDs are exact: `requirement`, `prd`, `field`, `api`.

- [ ] **Step 1: Write failing four-card and detail-navigation tests**

Create `document-hub.test.js` with global/unassigned/page fixtures. Assert:

```js
expect([...root.querySelectorAll("[data-hub-category]")].map((node) => node.dataset.hubCategory))
  .toEqual(["requirement", "prd", "field", "api"]);
expect(card("field").textContent).toContain("总字段规范");
expect(card("field").textContent).toContain("全局文档 1");
expect(card("field").textContent).toContain("待关联候选 1");

card("field").click();
expect(root.querySelector("[data-hub-view='detail']").hidden).toBe(false);
expect(section("global").textContent).toContain("Global Fields");
expect(section("candidates").textContent).toContain("Unassigned Fields");
expect(root.textContent).not.toContain("Page A Fields");

root.querySelector("[data-action='back-to-document-hub']").click();
expect(root.querySelector("[data-hub-view='entries']").hidden).toBe(false);
```

Add tests for all four mapping groups and both empty sections.

- [ ] **Step 2: Run hub tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/document-hub.test.js
```

Expected: FAIL because `document-hub.js` does not exist.

- [ ] **Step 3: Add the hub shell container**

Replace the old related-document container with:

```html
<div data-role="document-hub">
  <div data-hub-view="entries"></div>
  <div data-hub-view="detail" hidden>
    <button type="button" class="secondary-button hub-back" data-action="back-to-document-hub">返回文档入口</button>
    <h3 data-role="hub-detail-title"></h3>
    <section aria-labelledby="hub-global-heading">
      <h4 id="hub-global-heading">全局文档</h4>
      <div data-role="hub-global-documents"></div>
    </section>
    <section aria-labelledby="hub-candidate-heading">
      <h4 id="hub-candidate-heading">待关联候选</h4>
      <div data-role="hub-candidate-documents"></div>
    </section>
  </div>
</div>
```

- [ ] **Step 4: Implement read-only hub rendering**

Define exact category metadata:

```js
const HUB_CATEGORIES = [
  { id: "requirement", label: "总需求文档" },
  { id: "prd", label: "总 PRD 文档" },
  { id: "field", label: "总字段规范" },
  { id: "api", label: "总接口文档" }
];
```

For each category, split entries by `scope === "global"` and `scope === "unassigned"`. Exclude every page-scoped entry. Render counts on cards and retain source path, kind, preview state, missing/stale warnings, and Markdown content through the shared card renderer.

`reset()` returns to entry cards and is called whenever the logical page changes or the related Tab is reinitialized.

- [ ] **Step 5: Style narrow-Drawer entry cards and detail state**

Use one-column cards with stable focus/hover states, no nested decorative cards, long-title wrapping, and count badges. Ensure the back control is visible before detail content and remains reachable by keyboard.

- [ ] **Step 6: Run Task 4 tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/document-hub.test.js tests/unit/prd-drawer.test.js tests/unit/route-switching.test.js
```

Expected: all selected test files pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add prd-annotator/src/ui/document-hub.js prd-annotator/src/ui/shell.js prd-annotator/src/ui/styles.js prd-annotator/src/runtime/controller.js tests/unit/document-hub.test.js tests/unit/prd-drawer.test.js tests/unit/route-switching.test.js
git commit -m "feat: add global document hub"
```

---

### Task 5: Skill rules, data documentation, and public workflow

**Files:**
- Modify: `prd-annotator-skill/SKILL.md`
- Modify: `prd-annotator-skill/references/data-schema.md`
- Modify: `prd-annotator-skill/references/prd-workflow.md`
- Modify: `prd-annotator-skill/references/document-writing.md`
- Modify: `prd-annotator-skill/references/field-spec.md`
- Modify: `prd-annotator-skill/references/api-document.md`
- Modify: `README.md`
- Modify: `docs/route-and-document-workflow.md`
- Test: `tests/unit/skill-scripts.test.js`
- Test: `tests/unit/release-package.test.js`

**Interfaces:**
- Documents the exact Task 1 scope contract and Task 3/4 Drawer destinations.
- Does not add a magic trigger phrase or any document write during synchronization.

- [ ] **Step 1: Write failing Skill contract tests**

Add assertions that the Skill and references explicitly contain:

```js
expect(dataSchema).toContain('`scope` may be `page`, `global`, or `unassigned`');
expect(workflow).toContain("page Field specification");
expect(workflow).toContain("total Field specification");
expect(workflow).toContain("ask when page and global scope are both plausible");
expect(workflow).toContain("directory proximity, filename similarity, and the current page are not ownership evidence");
expect(skill).toContain("annotation synchronization alone must never create, edit, or re-scope a document");
```

Add public-document assertions for exact top-level Tab order, `本页补充资料`, the four global cards, and `待关联候选`.

- [ ] **Step 2: Run Skill/public tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/release-package.test.js -t "scope|document hub|page Field|page API"
```

Expected: FAIL because current Skill/docs treat Field/API documents as unscoped document types.

- [ ] **Step 3: Update the Skill control flow and schema reference**

Document exact natural-language behavior:

- clear current/named page request → `scope: page`, selected logical `pageIds`;
- clear total/project request → `scope: global`, empty `pageIds`;
- both plausible → ask once, never guess;
- type-only existing document → `scope: unassigned`;
- authorization is required for source writes and for changing an existing document association;
- refresh writes normalized inventory/View metadata but never edits source documents or annotation JSON.

Add a stop signal for any unbound Field/API document being shown as current-page or global without evidence.

- [ ] **Step 4: Update specialized Field/API writing references**

Add scope-aware introductions:

- page Field/API documents describe only one Manifest-resolved logical page and use its terminology/behavior;
- total Field/API documents provide a project-wide index and shared contracts without copying every page document verbatim;
- when scope is ambiguous, writing stops before selecting a file/root;
- completion reports explicit scope, page IDs, source path, Drawer destination, and gate result.

- [ ] **Step 5: Update README and route/document workflow**

Document exact top-level order and two-level navigation. Replace claims that all Field/API documents enter dedicated page Tabs with the scope-aware rules. State that unassigned candidates remain visible only inside the appropriate global hub detail.

- [ ] **Step 6: Run Task 5 tests and Skill validator**

Run:

```powershell
npx vitest run tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
& 'C:\Users\28920\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 'C:\Users\28920\.codex\skills\.system\skill-creator\scripts\quick_validate.py' 'D:\Codexdoc\My\project_prdjs\code\prd-annotator-skill'
```

Expected: tests pass and validator prints `Skill is valid!`.

- [ ] **Step 7: Commit Task 5**

```powershell
git add prd-annotator-skill/SKILL.md prd-annotator-skill/references/data-schema.md prd-annotator-skill/references/prd-workflow.md prd-annotator-skill/references/document-writing.md prd-annotator-skill/references/field-spec.md prd-annotator-skill/references/api-document.md README.md docs/route-and-document-workflow.md tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
git commit -m "docs: define page and global document workflows"
```

---

### Task 6: Browser regression coverage, build, and complete gates

**Files:**
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `tests/unit/release-package.test.js`
- Generated: `prd-annotator/prd-annotator.js`
- No Release version bump or publication in this task unless separately authorized by the user.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified single-file SDK on current package version and an evidence-backed readiness report.

- [ ] **Step 1: Write failing E2E scenarios**

Add one realistic View fixture containing:

- current-page page PRD, page Field specification, page API document, and page supplement;
- another-page Field/API documents;
- one global and one unassigned document for each hub category;
- long PRD content that requires scrolling.

Exercise:

```js
await page.getByRole("button", { name: "PRD 标注" }).click();
await expect(page.getByRole("tab").allTextContents()).resolves.toEqual([
  "本页标注 0", "页面 PRD", "页面字段规范", "页面接口文档", "关联文档"
]);
await page.getByRole("tab", { name: "页面 PRD" }).click();
await expect(page.getByRole("tab", { name: /本页补充资料 1/ })).toBeVisible();
await page.getByRole("tab", { name: "页面字段规范" }).click();
await expect(page.getByText("Current Page Fields")).toBeVisible();
await expect(page.getByText("Other Page Fields")).toHaveCount(0);
await page.getByRole("tab", { name: "关联文档" }).click();
await page.getByRole("button", { name: /总字段规范/ }).click();
await expect(page.getByText("全局文档")).toBeVisible();
await expect(page.getByText("待关联候选")).toBeVisible();
```

Also test narrow viewport keyboard activation and route switching back to the entry/page default states.

- [ ] **Step 2: Run targeted E2E and verify RED**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js -g "page-scoped documents and global hub"
```

Expected: FAIL before the final integration/build, or report the exact pre-test worker/environment failure if the browser cannot launch. Do not claim a browser pass in the latter case.

- [ ] **Step 3: Build the single-file SDK and run focused integration tests**

Run:

```powershell
npm run build
npx vitest run tests/unit/document-scope-agent.test.js tests/unit/document-scope.test.js tests/unit/document-discovery.test.js tests/unit/view-builder.test.js tests/unit/project-gate.test.js tests/unit/view-data.test.js tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/document-hub.test.js tests/unit/route-switching.test.js tests/unit/skill-scripts.test.js tests/unit/release-package.test.js
```

Expected: build exits 0 and all focused unit tests pass.

- [ ] **Step 4: Run browser verification against the built SDK**

Run the targeted E2E command again. If workers run, require PASS and inspect at least one desktop and one narrow viewport screenshot/state for:

- exact Tab order;
- page document isolation;
- top-visible PRD secondary switch;
- four-card hub and detail return;
- no clipped/overlapping long labels;
- keyboard focus and hidden/selected states.

If workers fail before test bodies, record the environment error and continue only with an explicit “browser unverified” status; never convert that into a pass.

- [ ] **Step 5: Run the full fresh verification suite**

Run:

```powershell
npm run test:unit
npm run build
npm run check:repo
git diff --check
& 'C:\Users\28920\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 'C:\Users\28920\.codex\skills\.system\skill-creator\scripts\quick_validate.py' 'D:\Codexdoc\My\project_prdjs\code\prd-annotator-skill'
```

Then scan tracked files for UTF-8 BOM and require none. Expected: unit tests, build, repository check, diff check, Skill validator, ASCII path policy, and BOM check all pass.

- [ ] **Step 6: Re-read acceptance criteria and inspect the final diff**

Verify line-by-line:

- page A never displays page B Field/API documents;
- global/unassigned never enter page-level Tabs;
- four hub cards and counts are exact;
- page supplements remain immediately reachable;
- historical no-scope data normalizes safely;
- annotation files and authorization rules are untouched;
- no hidden project save service or browser write transport exists.

Run:

```powershell
git status --short
git diff --stat HEAD~5..HEAD
git diff --check HEAD~5..HEAD
```

Expected: only planned files changed and no whitespace errors.

- [ ] **Step 7: Commit Task 6**

```powershell
git add tests/e2e/prd-annotator.spec.js tests/unit/release-package.test.js prd-annotator/prd-annotator.js
git commit -m "test: verify page-scoped document navigation"
```

- [ ] **Step 8: Completion boundary**

Report implementation/test/browser evidence and remaining risks. Do not push `master`, create a tag, publish a Release, or update the installed global Skill unless the user separately requests those deployment actions.
