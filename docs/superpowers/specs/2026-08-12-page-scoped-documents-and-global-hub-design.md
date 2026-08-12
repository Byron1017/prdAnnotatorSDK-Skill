# Page-scoped documents and global document hub design

## 1. Purpose

PRD Annotator currently classifies Field specifications and API documents by type, but a type alone does not establish document ownership. The View builder includes every unbound `field-spec` and `api-doc` in every logical page View, and the Drawer does not filter those groups by `pageIds`. This makes project-wide or unrelated documents appear as if they belong to the current HTML or Hash-route page.

This change separates document type from document scope. Page PRDs, page Field specifications, and page API documents follow the current logical page. Project-wide documents move into a final `关联文档` Tab that acts as a four-entry global document hub. Ambiguous documents remain visible as unassigned candidates without being presented as page-owned or global facts.

This design does not change annotation fields, annotation storage, merge, deletion, fingerprints, page identity, or document-write authorization.

## 2. Goals

- Isolate page PRDs, page Field specifications, and page API documents by logical page ID.
- Support both distinct physical HTML pages and registered Hash-route pages.
- Provide one global document hub with four entry cards:
  - 总需求文档
  - 总 PRD 文档
  - 总字段规范
  - 总接口文档
- Preserve ambiguous documents as `待关联候选` without showing them in page-level Tabs.
- Keep page-related requirement, flow, and note documents visible through an immediately accessible `本页补充资料` secondary view.
- Preserve schema version 2 and historical project data.
- Require explicit user authorization for every source-document write.

## 3. Non-goals

- Do not create, edit, merge, move, delete, or choose source documents during installation, annotation synchronization, route refresh, or View refresh.
- Do not modify annotation schema or annotation behavior.
- Do not infer page ownership from the currently open page, nearby directories, similar filenames, numeric path segments, or live Hash parameters.
- Do not add browser controls for changing document ownership, merging documents, or deleting documents.
- Do not change the rule that all plausible document candidates remain available to the user.

## 4. Document scope contract

Continue using `schemaVersion: 2`. Add an optional `scope` property to Manifest and generated View document entries:

```json
{
  "id": "doc-abc123",
  "path": "doc/field-specs/message-center.md",
  "title": "Message center fields",
  "kind": "field-spec",
  "scope": "page",
  "pageIds": ["message-center-a13f92"]
}
```

Allowed values are:

- `page`: the document belongs to one or more explicitly identified logical pages. `pageIds` must be non-empty and contain valid Manifest page IDs.
- `global`: the document is an explicitly identified project-wide document. `pageIds` must be empty.
- `unassigned`: the document type is known or plausible, but page/global ownership is not proven. `pageIds` must be empty.

### 4.1 Compatibility inference

Historical entries may omit `scope`. Readers infer scope without destructive migration:

1. Non-empty `pageIds` means `page`.
2. `total-prd`, `public`, and `public-rule` with empty `pageIds` mean `global`.
3. Empty-page `field-spec`, `api-doc`, `page-prd`, `requirement`, `other`, and `unclassified` mean `unassigned`.

The next authorized inventory refresh writes an explicit inferred `scope` while preserving document IDs, paths, kinds, manual mappings, display groups, evidence, missing states, and fingerprints.

### 4.2 Scope and kind consistency

- `total-prd`, `public`, and `public-rule` are global kinds and cannot be page-scoped or unassigned after validation.
- `page-prd` cannot be global. With page evidence it is `page`; without page evidence it is `unassigned`.
- `field-spec` and `api-doc` may be `page`, `global`, or `unassigned`.
- `requirement` and `other` may be `page`, `global`, or `unassigned` when evidence supports that scope.
- `unclassified` remains `unassigned` until an AI Agent, acting on user intent and evidence, assigns both a more reliable kind and scope.

Manual `scope`, `pageIds`, kind, display groups, title, and evidence remain authoritative presentation mappings. The project gate validates that those properties agree; it does not reinterpret user-selected mappings.

### 4.3 Discovery boundary

Automatic discovery may classify document type from reliable path/content evidence. It must not treat type evidence as ownership evidence.

- A newly discovered Field specification or API document with no prior explicit mapping becomes `unassigned`.
- A newly discovered ambiguous PRD remains `unassigned`.
- Only explicit project-level evidence may produce a global classification such as `total-prd`, `public`, or `public-rule`.
- Page ownership requires an existing manual association, managed page-PRD provenance, or another evidence-backed mapping written by the AI Agent after user intent.

## 5. View bundle selection

Each generated logical-page View contains only:

1. `scope: page` documents whose `pageIds` include the current logical page ID.
2. Every `scope: global` document needed by the global document hub.
3. Every `scope: unassigned` candidate needed by the hub's `待关联候选` sections.

It must never contain a `scope: page` document belonging only to another page. This rule applies independently to multiple HTML files and to each registered Hash-route page. Query values and live route parameters do not affect the logical page ID.

Generated View documents include explicit `scope`. The SDK validates it and refuses malformed scope/page combinations without discarding browser annotations.

## 6. Drawer information architecture

The fixed top-level Tab order is:

1. `本页标注`
2. `页面 PRD`
3. `页面字段规范`
4. `页面接口文档`
5. `关联文档`

Only one top-level panel is visible at a time. The `关联文档` Tab is always last.

### 6.1 Page-level Tabs

- `页面 PRD` shows only page-scoped `page-prd` documents linked to the current logical page.
- `页面字段规范` shows only page-scoped `field-spec` documents linked to the current logical page.
- `页面接口文档` shows only page-scoped `api-doc` documents linked to the current logical page.

Switching HTML pages or registered Hash routes replaces all three panels with that logical page's documents. There is no fallback to another page, a global document, or an unassigned candidate.

Each empty page panel states that the current page has no linked document of that type and tells the user that an AI Agent must generate or associate it after an explicit request.

### 6.2 Page PRD secondary switch

The `页面 PRD` Tab has a secondary switch fixed at the top of its panel:

```text
[ 页面 PRD ] [ 本页补充资料 3 ]
────────────────────────────
Selected secondary content
```

The switch remains immediately visible when entering the Tab; users never need to scroll through a long PRD to find supplementary documents. Only the selected secondary panel is rendered in the content area.

- `页面 PRD` contains current-page `page-prd` documents.
- `本页补充资料` contains other `scope: page` documents linked to the current page, such as page requirements, flows, notes, or supporting material that are not page PRDs, Field specifications, or API documents.
- The supplementary switch displays a count badge. Zero items produce an explicit empty state.
- The selected secondary state is reset safely when a route/page change would otherwise leave the user viewing content that no longer exists.

### 6.3 Global document hub

The default `关联文档` view displays four vertically stacked, clickable entry cards suitable for a narrow Drawer:

1. 总需求文档
2. 总 PRD 文档
3. 总字段规范
4. 总接口文档

Each card displays two counts:

- global document count
- unassigned candidate count

Selecting a card opens a category detail view. A visible `返回文档入口` control returns to the four-card hub. The detail view has two separate sections:

- `全局文档`
- `待关联候选`

The category mapping is:

- 总需求文档:
  - global: `requirement`, `public`, `public-rule`, and `other` with `scope: global`
  - candidates: unassigned `requirement`, `other`, and `unclassified`
- 总 PRD 文档:
  - global: `total-prd` with `scope: global`
  - candidates: unassigned `page-prd`
- 总字段规范:
  - global: `field-spec` with `scope: global`
  - candidates: unassigned `field-spec`
- 总接口文档:
  - global: `api-doc` with `scope: global`
  - candidates: unassigned `api-doc`

Page-scoped documents never appear in the global hub. Unassigned documents never appear as global documents. Empty sections remain visible with clear empty-state text.

The browser hub is read-only. It provides no merge, ownership, deletion, or document-writing action.

## 7. AI Skill document rules

Document work remains separately consent-gated and requires no magic trigger phrase.

### 7.1 Page-level document requests

When the user clearly requests the current/named page's document:

- page PRD: `kind: page-prd`
- page Field specification: `kind: field-spec`
- page API document: `kind: api-doc`

All use `scope: page`, and `pageIds` contains only the intended logical page IDs. The Agent must resolve a physical HTML page or registered Hash-route page through the Manifest rather than using a live parameter value.

### 7.2 Global document requests

When the user clearly requests a total/global document:

- total requirements document: `kind: requirement`
- total PRD: `kind: total-prd`
- total Field specification: `kind: field-spec`
- total API document: `kind: api-doc`

All use `scope: global` and `pageIds: []`.

### 7.3 Ambiguous requests and existing documents

- If `生成字段规范` or `生成接口文档` clearly refers to the current page, treat it as page-level.
- If context clearly covers the whole project, treat it as global.
- If both interpretations are plausible, ask the user; never guess.
- Existing documents require explicit ownership evidence before changing scope.
- Directory proximity, filename similarity, the currently open page, and live route values are insufficient ownership evidence.
- Documents with type evidence but no scope evidence remain `unassigned`.

### 7.4 Authorized write completion

After an authorized source-document write or association change, the Agent:

1. Updates the selected source document only.
2. Updates the Manifest document entry with explicit `kind`, `scope`, and `pageIds`.
3. Regenerates every affected logical-page View.
4. Runs the complete project gate.
5. Reports changed source documents, scope, associated pages, Drawer destination, and gate result.

Installation, annotation creation/edit/delete/synchronization, route registration, and View refresh alone never authorize source-document changes.

## 8. Validation and failure handling

The project gate validates:

- `scope` is `page`, `global`, or `unassigned` after normalization.
- `page` has at least one valid Manifest `pageId`.
- `global` and `unassigned` have empty `pageIds`.
- kind/scope combinations obey section 4.2.
- Manifest and generated View `scope`, `pageIds`, kind, and display metadata match.
- no View contains another page's page-scoped document.
- all global and unassigned inventory entries required by the hub are retained.

Missing, stale, unavailable, or unpreviewable source documents remain visible in their correct section with source path and status. A malformed View causes the SDK's existing “AI Agent must regenerate page data” warning and must not clear browser-local annotations.

## 9. Compatibility and migration

- Keep `schemaVersion: 2`.
- Do not rewrite annotation JSON or fingerprints.
- Read historical documents without `scope` using section 4.1.
- The first authorized refresh writes explicit scope into Manifest and Views; it does not edit source documents.
- Existing page-linked Field/API documents remain page-linked.
- Existing unlinked Field/API documents become unassigned candidates instead of appearing on every page.
- Existing page-linked requirements, flows, and notes appear in `本页补充资料`.
- Existing total PRD and public-rule documents remain global.
- Missing historical entries retain their inferred scope and mapping.

## 10. Testing strategy

### 10.1 Unit and contract tests

- RED tests prove unbound Field/API documents no longer enter page-level panels.
- Scope inference tests cover all historical compatibility cases.
- Discovery tests prove type classification does not invent page/global ownership.
- Gate tests reject invalid scope/page/kind combinations and stale Manifest/View scope.
- View builder tests prove:
  - current-page page documents are included;
  - other-page page documents are excluded;
  - global and unassigned documents are retained for the hub;
  - multiple HTML and Hash-route pages remain isolated.
- Drawer tests prove exact top-level Tab order and labels.
- Drawer tests prove the page PRD secondary switch is at the top and does not require scrolling through PRD content.
- Hub tests prove four cards, counts, category detail, separated global/candidate sections, and return navigation.
- Route-switching tests prove no document state leaks across logical pages.
- Skill tests prove page/global generation rules, ambiguity questions, consent boundaries, and post-write gates.

### 10.2 Browser and visual checks

- Verify desktop and narrow/mobile Drawer widths.
- Verify long PRD content does not hide the `本页补充资料` switch.
- Verify long titles, many candidates, zero candidates, missing previews, and stale previews.
- Verify keyboard focus, selected/hidden Tab states, secondary switch semantics, entry-card activation, and return navigation.
- Verify no horizontal Tab label confusion after the longer `页面字段规范` and `页面接口文档` labels.

### 10.3 Release gates

- Full unit suite.
- SDK build.
- Skill validator.
- Repository policy check and ASCII tracked-path gate.
- `git diff --check` and UTF-8 without BOM validation.
- Browser/E2E checks when the environment can start Playwright workers; report environmental inability truthfully.

## 11. Acceptance criteria

- A Field/API document linked to page A never appears in page B's page-level Tabs.
- An unlinked Field/API document appears only as a pending candidate under its global hub category.
- A global Field/API document appears only under the corresponding global hub category, not in page-level Tabs.
- The global hub is the final top-level Tab and opens with exactly four entry cards.
- Every entry card opens a detail page with `全局文档`, `待关联候选`, and a visible return control.
- The page PRD Tab exposes `页面 PRD` and `本页补充资料` immediately at the top, independent of PRD length.
- Multiple HTML, Hash routes, query parameters, dynamic parameters, direct deep links, and ordinary anchors preserve existing page identity rules.
- Existing documents are retained and receive a safe explicit scope on refresh.
- Annotation behavior and document-write authorization boundaries remain unchanged.
