# Wide Drawer and Document Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the PRD Annotator Drawer responsively, show all five primary Tabs on one desktop row, and improve the four document panels as readable technical-document workspaces without changing data or interaction behavior.

**Architecture:** Keep the existing Shadow DOM shell, Tab controller, Markdown renderer, document inventory, and annotation cards intact. Implement the feature as source CSS changes in `styles.js`, protect the layout with focused Vitest style contracts and Playwright geometry checks, then rebuild the generated single-file SDK from the tested source.

**Tech Stack:** JavaScript, CSS-in-JS template string, Shadow DOM, Vitest with jsdom, Playwright, esbuild.

## Global Constraints

- On desktop, set the Drawer width to `clamp(720px, 56vw, 900px)`.
- When the viewport cannot accommodate the `720px` minimum, let the Drawer occupy the full viewport width.
- At `1280px`, `1440px`, and `1920px`, all five primary Tabs must fit on one line with no horizontal scrollbar.
- Header and primary Tabs remain sticky.
- Page PRD secondary switch remains non-sticky and scrolls with content.
- Apply an `800px` centered reading measure only to Page PRD, Page Field specification, Page API document, and Related documents.
- Keep the Annotations panel structurally unchanged; do not redesign annotation cards.
- Document body typography is `15px` with `1.75` line-height.
- Table overflow remains local to `.markdown-table-scroll`; a table must not widen the Drawer or prototype page.
- Keep the four Related-document entry cards and their current drill-in interaction.
- Do not add an outline, split view, new interaction, new dependency, or Markdown transformation.
- This is a presentation-only SDK change.
- Do not modify annotations, annotation cards, document inventory, View data, Markdown source, document scope, routes, localStorage, synchronization payloads, or Skill rules.
- Do not create, update, choose, merge, or remove a PRD, Field specification, API document, or related document.
- Keep package and SDK version `2.5.1` during implementation.
- Keep tracked paths ASCII-only and text UTF-8 without BOM.
- Do not push, publish a Release, or update the installed global Skill without separate authorization.

## File Structure

- `prd-annotator/src/ui/styles.js` — source of truth for responsive Drawer geometry, Tab distribution, document-panel measure, document cards, Markdown typography, tables, and narrow-screen fallbacks.
- `tests/unit/drawer-tabs.test.js` — fast style contracts for Drawer width, sticky/full-row Tabs, mobile fallback, document-panel scope, reading typography, cards, and table-local overflow.
- `tests/e2e/prd-annotator.spec.js` — actual browser geometry, responsive overflow, sticky/normal-flow, document readability, wide-table, code-block, Related-document card, and interaction regression checks.
- `prd-annotator/prd-annotator.js` — generated single-file SDK rebuilt from the source after tests pass; never edit this file manually.

---

### Task 1: Responsive Drawer and Primary Tabs

**Files:**
- Modify: `tests/unit/drawer-tabs.test.js:69-74`
- Modify: `tests/e2e/prd-annotator.spec.js:140-174`
- Modify: `prd-annotator/src/ui/styles.js:178-192,373-403,988-1024`

**Interfaces:**
- Consumes: Existing `.drawer`, `.drawer-tabs`, five `button[role="tab"]` elements, and the `@media (max-width: 520px)` mobile rules.
- Produces: `clamp(720px, 56vw, 900px)` desktop Drawer geometry, five equal-availability desktop Tabs without wrapping, and an explicit `719px`-and-below horizontal-scroll fallback.

- [ ] **Step 1: Replace the narrow-only unit contract with desktop and fallback contracts**

Replace the current `keeps the Tab bar sticky and horizontally operable on narrow screens` test with these two tests:

```js
it("uses a responsive wide Drawer and distributes all desktop tabs", () => {
  const drawerRule = styles.match(
    /\.editor,\s*\.drawer\s*\{[^}]*\}\s*\.drawer\s*\{([^}]*)\}/
  )?.[1] ?? "";
  const tabsRule = styles.match(/\.drawer-tabs\s*\{([^}]*)\}/)?.[1] ?? "";
  const tabButtonRule = styles.match(
    /\.drawer-tabs button\[role="tab"\]\s*\{([^}]*)\}/
  )?.[1] ?? "";

  expect(drawerRule).toMatch(/width:\s*clamp\(720px,\s*56vw,\s*900px\)/);
  expect(drawerRule).toMatch(/max-width:\s*100%/);
  expect(drawerRule).toMatch(/overflow-x:\s*hidden/);
  expect(tabsRule).toMatch(/position:\s*sticky/);
  expect(tabsRule).toMatch(/top:\s*84px/);
  expect(tabsRule).toMatch(/overflow-x:\s*hidden/);
  expect(tabButtonRule).toMatch(/flex:\s*1 1 0/);
  expect(tabButtonRule).toMatch(/min-width:\s*0/);
  expect(tabButtonRule).toMatch(/white-space:\s*nowrap/);
});

it("restores non-compressing horizontal Tab scrolling below 720px", () => {
  const narrowStart = styles.indexOf("@media (max-width: 719px)");
  const mobileStart = styles.indexOf("@media (max-width: 520px)");
  const narrowStyles = styles.slice(narrowStart, mobileStart);

  expect(narrowStart).toBeGreaterThan(-1);
  expect(mobileStart).toBeGreaterThan(narrowStart);
  expect(narrowStyles).toMatch(/\.drawer-tabs\s*\{[^}]*overflow-x:\s*auto/);
  expect(narrowStyles).toMatch(
    /\.drawer-tabs button\[role="tab"\]\s*\{[^}]*flex:\s*0 0 auto/
  );
  expect(narrowStyles).toMatch(/min-width:\s*max-content/);
});
```

- [ ] **Step 2: Run the focused unit tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js -t "responsive wide Drawer|below 720px"
```

Expected: both tests fail because the Drawer is still `min(480px, 100%)`, desktop Tabs are fixed-width scroll items, and the `719px` fallback does not exist.

- [ ] **Step 3: Add browser geometry coverage for desktop, intermediate, and mobile widths**

Insert this test immediately before the existing narrow-screen Tab test in `tests/e2e/prd-annotator.spec.js`:

```js
test("uses a wide Drawer with one complete primary Tab row on desktop", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  await page.evaluate(() => window.PRDAnnotatorReady);
  const host = await openDrawer(page);

  for (const viewportWidth of [1280, 1440, 1920]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });

    const drawerBox = await host.locator("[data-role='drawer']").boundingBox();
    const tabLayout = await host.locator(".drawer-tabs").evaluate((tabBar) => {
      const barRect = tabBar.getBoundingClientRect();
      const tabs = [...tabBar.querySelectorAll("[role='tab']")];
      return {
        clientWidth: tabBar.clientWidth,
        scrollWidth: tabBar.scrollWidth,
        overflowX: getComputedStyle(tabBar).overflowX,
        rowTops: [...new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)))],
        allContained: tabs.every((tab) => {
          const rect = tab.getBoundingClientRect();
          return rect.left >= barRect.left && rect.right <= barRect.right;
        })
      };
    });
    const expectedWidth = Math.min(900, Math.max(720, viewportWidth * 0.56));

    expect(Math.abs(drawerBox.width - expectedWidth)).toBeLessThanOrEqual(1);
    expect(tabLayout.overflowX).toBe("hidden");
    expect(tabLayout.scrollWidth).toBeLessThanOrEqual(tabLayout.clientWidth);
    expect(tabLayout.rowTops).toHaveLength(1);
    expect(tabLayout.allContained).toBe(true);
  }

  await page.setViewportSize({ width: 640, height: 800 });
  const intermediate = await host.locator("[data-role='drawer']").boundingBox();
  expect(intermediate.x).toBeGreaterThanOrEqual(0);
  expect(intermediate.width).toBeLessThanOrEqual(640);
});
```

Keep the existing `390px` narrow-screen test and its final `overflowX === "auto"` assertion. It remains the mobile fallback regression.

- [ ] **Step 4: Run the new browser test and verify RED**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "wide Drawer with one complete primary Tab row"
```

Expected: FAIL because the computed Drawer width is still `480px` and the desktop Tab bar overflows horizontally.

- [ ] **Step 5: Implement the responsive Drawer and desktop Tab rules**

In the shared `.editor, .drawer` block, remove only `width: min(480px, 100%);`, keep the shared positioning, height, border, surface, pointer, and vertical overflow rules, then insert this rule before `.editor`:

```css
.drawer {
  width: clamp(720px, 56vw, 900px);
  max-width: 100%;
  overflow-x: hidden;
}
```

Replace the base Tab rules with:

```css
.drawer-tabs {
  position: sticky;
  top: 84px;
  z-index: 1;
  display: flex;
  margin: 0 -20px;
  border-block: 1px solid var(--prd-color-border);
  padding: 8px 20px;
  background: rgb(255 255 255 / 97%);
  gap: 6px;
  overflow-x: hidden;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.drawer-tabs button[role="tab"] {
  flex: 1 1 0;
  min-width: 0;
  border-color: transparent;
  padding: 8px 10px;
  background: transparent;
  color: #475569;
  box-shadow: none;
  text-align: center;
  white-space: nowrap;
}
```

Insert this media query immediately before the existing `@media (max-width: 520px)` block:

```css
@media (max-width: 719px) {
  .drawer-tabs {
    overflow-x: auto;
  }

  .drawer-tabs button[role="tab"] {
    flex: 0 0 auto;
    min-width: max-content;
  }
}
```

Do not change the selected, hover, focus-visible, keyboard, or panel-switching rules.

- [ ] **Step 6: Run focused unit and browser verification and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js
npx playwright test tests/e2e/prd-annotator.spec.js --grep "wide Drawer with one complete primary Tab row|Drawer tabs show one document group|unified Drawer inside a mobile viewport"
```

Expected: all focused tests pass; `1280px`, `1440px`, and `1920px` have one complete Tab row without overflow, `640px` fits the viewport, and `390px` retains horizontal Tab scrolling without page overflow.

- [ ] **Step 7: Commit the independently verified responsive shell**

```powershell
git add tests/unit/drawer-tabs.test.js tests/e2e/prd-annotator.spec.js prd-annotator/src/ui/styles.js
git commit -m "style: widen PRD Annotator drawer"
```

Expected: a local commit succeeds on `master`; nothing is pushed and no version changes.

---

### Task 2: Center the Four Document Reading Panels

**Files:**
- Modify: `tests/unit/drawer-tabs.test.js`
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `prd-annotator/src/ui/styles.js:404-406`

**Interfaces:**
- Consumes: Existing panel attributes `data-panel="annotations|page-prd|field-spec|api-doc|related"` and the existing Page PRD secondary switch.
- Produces: A `width: 100%`, `max-width: 800px`, centered measure for exactly four document panels; annotations remain outside that contract.

- [ ] **Step 1: Add the scoped reading-measure unit contract**

Add this test after the responsive Tab tests:

```js
it("centers exactly the four document panels within an 800px reading measure", () => {
  const readingRule = styles.match(
    /\.drawer-panel\[data-panel="page-prd"\],\s*\.drawer-panel\[data-panel="field-spec"\],\s*\.drawer-panel\[data-panel="api-doc"\],\s*\.drawer-panel\[data-panel="related"\]\s*\{([^}]*)\}/
  )?.[1] ?? "";

  expect(readingRule).toMatch(/width:\s*100%/);
  expect(readingRule).toMatch(/max-width:\s*800px/);
  expect(readingRule).toMatch(/margin-inline:\s*auto/);
  expect(styles).not.toMatch(
    /\.drawer-panel\[data-panel="annotations"\][^{]*\{[^}]*max-width:/
  );
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js -t "four document panels"
```

Expected: FAIL because every panel currently uses the Drawer body's full available width and no `800px` reading rule exists.

- [ ] **Step 3: Add actual computed-style scope coverage**

Append these assertions inside the desktop loop's `1920px` iteration in the Task 1 Playwright test, after the Tab assertions:

```js
if (viewportWidth === 1920) {
  for (const panelName of ["page-prd", "field-spec", "api-doc", "related"]) {
    await host.locator(`[data-tab='${panelName}']`).click();
    const panelStyle = await host.locator(`[data-panel='${panelName}']`).evaluate((panel) => {
      const style = getComputedStyle(panel);
      return {
        maxWidth: style.maxWidth,
        width: panel.getBoundingClientRect().width,
        marginLeft: Number.parseFloat(style.marginLeft),
        marginRight: Number.parseFloat(style.marginRight)
      };
    });
    expect(panelStyle.maxWidth).toBe("800px");
    expect(panelStyle.width).toBeLessThanOrEqual(800);
    expect(Math.abs(panelStyle.marginLeft - panelStyle.marginRight)).toBeLessThanOrEqual(1);
  }

  await host.locator("[data-tab='annotations']").click();
  expect(await host.locator("[data-panel='annotations']").evaluate(
    (panel) => getComputedStyle(panel).maxWidth
  )).toBe("none");
}
```

- [ ] **Step 4: Implement the explicitly scoped reading measure**

Keep the existing base `.drawer-panel { padding-top: 20px; }` rule and add immediately after it:

```css
.drawer-panel[data-panel="page-prd"],
.drawer-panel[data-panel="field-spec"],
.drawer-panel[data-panel="api-doc"],
.drawer-panel[data-panel="related"] {
  width: 100%;
  max-width: 800px;
  margin-inline: auto;
}
```

Do not use a negation selector: the four approved document panels must remain an explicit allowlist, so future panels do not silently inherit a document layout.

- [ ] **Step 5: Verify scope, normal-flow secondary switch, and responsive behavior**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js
npx playwright test tests/e2e/prd-annotator.spec.js --grep "wide Drawer with one complete primary Tab row|page-scoped documents and global hub"
```

Expected: all tests pass; only the four document panels report `800px` max width, the annotation panel reports `none`, and the existing secondary-switch test still proves there is no sticky positioning, `top`, or `z-index` on the secondary control.

- [ ] **Step 6: Commit the independently verified reading workspace**

```powershell
git add tests/unit/drawer-tabs.test.js tests/e2e/prd-annotator.spec.js prd-annotator/src/ui/styles.js
git commit -m "style: center document reading panels"
```

Expected: a local commit succeeds; no annotation markup, data, or runtime JavaScript changes appear in the diff.

---

### Task 3: Improve Document Cards, Markdown, Tables, and Related-document Entries

**Files:**
- Modify: `tests/unit/drawer-tabs.test.js`
- Modify: `tests/e2e/prd-annotator.spec.js:818-875`
- Modify: `prd-annotator/src/ui/styles.js:428-469,690-814,815-985`

**Interfaces:**
- Consumes: Safe semantic output from `markdown.js`, including headings, paragraphs, lists, blockquotes, links, inline code, `pre`, `.markdown-table-scroll`, and `.markdown-table`; document header classes emitted by `appendDocumentCard()`; existing Related-document hub buttons.
- Produces: A consistent `15px/1.75` reading system, restrained white cards, clear heading hierarchy, locally scrollable technical content, and normalized Related-document entry cards without changing rendered content or navigation.

- [ ] **Step 1: Add unit contracts for document typography and visual hierarchy**

Add these tests to `tests/unit/drawer-tabs.test.js`:

```js
it("uses the approved document typography and heading hierarchy", () => {
  const contentRule = styles.match(
    /\[data-role="prd-content"\],\s*\.document-content\s*\{([^}]*)\}/
  )?.[1] ?? "";

  expect(contentRule).toMatch(/font-size:\s*15px/);
  expect(contentRule).toMatch(/line-height:\s*1\.75/);
  expect(contentRule).toMatch(/overflow-wrap:\s*anywhere/);
  expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h1\s*\{[^}]*font-size:\s*28px/);
  expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h2\s*\{[^}]*border-bottom:\s*1px solid/);
  expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) h3\s*\{[^}]*font-size:\s*17px/);
  expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) li \+ li\s*\{[^}]*margin-top:\s*6px/);
});

it("uses restrained document and Related-document cards", () => {
  const documentCardRule = styles.match(/\.document-card\s*\{([^}]*)\}/)?.[1] ?? "";
  const hubCardRule = styles.match(/\.document-hub-card\s*\{([^}]*)\}/)?.[1] ?? "";

  expect(documentCardRule).toMatch(/background:\s*#ffffff/);
  expect(documentCardRule).toMatch(/box-shadow:\s*none/);
  expect(documentCardRule).toMatch(/padding:\s*20px/);
  expect(hubCardRule).toMatch(/min-height:\s*96px/);
  expect(hubCardRule).toMatch(/background:\s*#ffffff/);
  expect(hubCardRule).toMatch(/box-shadow:\s*none/);
  expect(styles).toMatch(/\.document-content\s*\{[^}]*border-top:\s*1px solid/);
  expect(styles).toMatch(/\.empty-state\s*\{[^}]*background:\s*#ffffff/);
  expect(styles).toMatch(
    /\.view-warning,\s*\.document-warning\s*\{[^}]*border-radius:\s*6px/
  );
});

it("confines wide tables and code to their document surface", () => {
  const tableScrollRule = styles.match(/\.markdown-table-scroll\s*\{([^}]*)\}/)?.[1] ?? "";
  const tableRule = styles.match(/\.markdown-table\s*\{([^}]*)\}/)?.[1] ?? "";
  const tableCellRule = styles.match(
    /\.markdown-table th,\s*\.markdown-table td\s*\{([^}]*)\}/
  )?.[1] ?? "";

  expect(tableScrollRule).toMatch(/max-width:\s*100%/);
  expect(tableScrollRule).toMatch(/overflow-x:\s*auto/);
  expect(tableScrollRule).toMatch(/overflow-y:\s*hidden/);
  expect(tableRule).toMatch(/font-size:\s*13px/);
  expect(tableRule).toMatch(/line-height:\s*1\.6/);
  expect(tableCellRule).toMatch(/padding:\s*10px 12px/);
  expect(tableCellRule).toMatch(/overflow-wrap:\s*anywhere/);
  expect(styles).toMatch(/:is\(\[data-role="prd-content"\],\s*\.document-content\) pre\s*\{[^}]*overflow:\s*auto/);
});
```

- [ ] **Step 2: Run the style contracts and verify RED**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js -t "approved document typography|restrained document|wide tables and code"
```

Expected: all three tests fail against the current smaller typography, gray cards, inherited button elevation, tighter table cells, and incomplete local-overflow contract.

- [ ] **Step 3: Replace the document content typography with one shared visual system**

Replace the duplicated PRD/document-content typography rules with the following rules. Keep sync-state, warning, metadata, and other unrelated rules in their current order unless a later step explicitly replaces them.

```css
[data-role="prd-content"],
.document-content {
  color: #334155;
  font-size: 15px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

[data-role="prd-content"] {
  margin-top: 16px;
}

.document-content {
  margin-top: 18px;
  border-top: 1px solid #e2e8f0;
  padding-top: 18px;
}

:is([data-role="prd-content"], .document-content) > :first-child {
  margin-top: 0;
}

:is([data-role="prd-content"], .document-content) h1,
:is([data-role="prd-content"], .document-content) h2,
:is([data-role="prd-content"], .document-content) h3,
:is([data-role="prd-content"], .document-content) h4,
:is([data-role="prd-content"], .document-content) h5,
:is([data-role="prd-content"], .document-content) h6 {
  color: #17212b;
  overflow-wrap: anywhere;
}

:is([data-role="prd-content"], .document-content) h1 {
  margin: 0 0 20px;
  font-size: 28px;
  line-height: 1.25;
}

:is([data-role="prd-content"], .document-content) h2 {
  margin: 32px 0 14px;
  border-bottom: 1px solid #d5dde5;
  padding-bottom: 8px;
  font-size: 21px;
  line-height: 1.35;
}

:is([data-role="prd-content"], .document-content) h3 {
  margin: 26px 0 10px;
  font-size: 17px;
  line-height: 1.4;
}

:is([data-role="prd-content"], .document-content) h4 {
  margin: 22px 0 8px;
  font-size: 15px;
  line-height: 1.45;
}

:is([data-role="prd-content"], .document-content) h5 {
  margin: 20px 0 8px;
  color: #334155;
  font-size: 14px;
  line-height: 1.45;
}

:is([data-role="prd-content"], .document-content) h6 {
  margin: 18px 0 8px;
  color: #475569;
  font-size: 13px;
  line-height: 1.45;
}

:is([data-role="prd-content"], .document-content) p,
:is([data-role="prd-content"], .document-content) ul,
:is([data-role="prd-content"], .document-content) ol,
:is([data-role="prd-content"], .document-content) blockquote,
:is([data-role="prd-content"], .document-content) pre {
  margin: 12px 0;
}

:is([data-role="prd-content"], .document-content) ul,
:is([data-role="prd-content"], .document-content) ol {
  padding-left: 24px;
}

:is([data-role="prd-content"], .document-content) li + li {
  margin-top: 6px;
}

:is([data-role="prd-content"], .document-content) li > ul,
:is([data-role="prd-content"], .document-content) li > ol {
  margin-block: 6px;
}

:is([data-role="prd-content"], .document-content) blockquote {
  border-left: 3px solid #d97706;
  border-radius: 0 6px 6px 0;
  padding: 10px 14px;
  background: #fff7ed;
  color: #78350f;
  white-space: pre-wrap;
}

:is([data-role="prd-content"], .document-content) pre {
  max-width: 100%;
  overflow: auto;
  border-radius: 8px;
  padding: 16px;
  background: #17212b;
  color: #e2e8f0;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
}

:is([data-role="prd-content"], .document-content) hr {
  border: 0;
  border-top: 1px solid #d5dde5;
  margin: 28px 0;
}
```

Replace the inline-code rule with this wrapping-safe version while preserving its colors and font family:

```css
.markdown-inline-code {
  border-radius: 4px;
  padding: 1px 4px;
  background: #e2e8f0;
  color: #9a3412;
  font: 0.92em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: normal;
  overflow-wrap: anywhere;
}

.markdown-table th .markdown-inline-code {
  white-space: nowrap;
}
```

- [ ] **Step 4: Replace document and Related-document card presentation**

Replace the corresponding card/group/header rules with:

```css
[data-hub-view="entries"] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.document-hub-card {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 96px;
  align-content: start;
  gap: 8px;
  border: 1px solid #d5dde5;
  padding: 18px;
  background: #ffffff;
  box-shadow: none;
  color: #17212b;
  text-align: left;
}

.document-hub-card:hover {
  border-color: #94a3b8;
  background: #f8fafc;
}

.document-hub-card strong,
.document-hub-counts {
  overflow-wrap: anywhere;
}

.document-hub-card strong {
  font-size: 16px;
  line-height: 1.4;
}

.document-hub-counts {
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

.document-group {
  display: grid;
  gap: 16px;
}

.document-group + .document-group {
  margin-top: 28px;
}

.document-group-title {
  margin: 0;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.document-card {
  min-width: 0;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  padding: 20px;
  background: #ffffff;
  box-shadow: none;
  overflow-wrap: anywhere;
}

.document-title {
  margin: 0;
  color: #17212b;
  font-size: 18px;
  line-height: 1.35;
}

.document-path {
  margin-top: 8px !important;
  color: #64748b;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}

.document-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.document-format,
.document-kind,
.document-preview-status {
  display: inline-block;
  border-radius: 999px;
  padding: 3px 8px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  line-height: 1.4;
}
```

In the existing `@media (max-width: 520px)` block add:

```css
[data-hub-view="entries"] {
  grid-template-columns: 1fr;
}

.document-card {
  padding: 16px;
}
```

Keep the existing hub `Enter`/click behavior, back button, category count source, document order, and drill-in state unchanged.

- [ ] **Step 5: Strengthen technical table and empty/warning surfaces**

Replace the table rules with:

```css
.markdown-table-scroll {
  min-width: 0;
  max-width: 100%;
  margin: 16px 0;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid #d5dde5;
  border-radius: 8px;
  background: #ffffff;
  overscroll-behavior-inline: contain;
}

.markdown-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  color: #334155;
  font-size: 13px;
  line-height: 1.6;
}

.markdown-table th,
.markdown-table td {
  min-width: 104px;
  max-width: 320px;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 12px;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.markdown-table th {
  background: #f1f5f9;
  color: #17212b;
  font-weight: 700;
  white-space: nowrap;
}

.markdown-table tbody tr:nth-child(even) {
  background: #f8fafc;
}
```

Keep the existing last-column, last-row, explicitly empty-table, and alignment rules unchanged. Replace the empty-state rule with:

```css
.empty-state {
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  padding: 28px 18px;
  background: #ffffff;
  color: #64748b;
  line-height: 1.6;
  text-align: center;
}
```

Add `border-radius: 6px;` to the existing `.view-warning, .document-warning` visual block without changing warning text or state logic.

- [ ] **Step 6: Run the complete Drawer style suite and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/document-hub.test.js tests/unit/markdown.test.js
```

Expected: all tests pass, including semantic Markdown rendering, safe links/HTML handling, four-card hub behavior, document headers, table semantics, sticky top Tabs, and normal-flow secondary switch.

- [ ] **Step 7: Expand the browser readability fixture and assertions**

In `renders readable field and API Markdown without executing source HTML`, add `testInfo` to the fixture arguments and set the viewport before navigation:

```js
test("renders readable field and API Markdown without executing source HTML", async ({ page }, testInfo) => {
await page.setViewportSize({ width: 1920, height: 1000 });
```

Keep the existing test body inside this renamed callback; the snippet above changes only the callback signature and adds the first statement.

Replace the two Markdown strings passed to `documentEntry()` with:

```js
`# Fields

Field definitions explain the current page's data contract.

## Message record

| Field | Type | Required | Source | Validation | Default | Example | Empty behavior |
|---|---|---|---|---|---|---|---|
| \`id\` | \`string\` | Yes | API | UUID | None | \`message-001\` | Reject |
| \`deliveryTargetIdentifier\` | \`string\` | No | User input | 1-256 chars | Empty | \`tenant/device/channel/very-long-identifier\` | Ignore |`
```

and:

```js
`# API

## List messages

| Method | Path | Authentication | Request | Response | Error | Retry | Notes |
|---|---|---|---|---|---|---|---|
| \`GET\` | \`/messages/{tenantId}/deliveries\` | Bearer | Query | Message page | 401/403/500 | Safe | Returns current tenant messages |

\`\`\`http
GET /messages/tenant-with-a-very-long-identifier/deliveries?include=delivery-status-and-recipient-details HTTP/1.1
Authorization: Bearer example-token-that-is-intentionally-long-to-require-local-code-scrolling
\`\`\`

[unsafe](javascript:window.hacked=true)

<script>window.hacked=true</script>`
```

After the existing safety assertions, add:

```js
await host.locator("[data-tab='field-spec']").click();
const fieldContent = fieldCard.locator(".document-content");
const fieldTypography = await fieldContent.evaluate((content) => {
  const style = getComputedStyle(content);
  const h2 = content.querySelector("h2");
  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    h2Border: getComputedStyle(h2).borderBottomWidth
  };
});
expect(fieldTypography).toEqual({
  fontSize: "15px",
  lineHeight: "26.25px",
  h2Border: "1px"
});

const fieldCardStyle = await fieldCard.evaluate((card) => {
  const style = getComputedStyle(card);
  return { background: style.backgroundColor, shadow: style.boxShadow };
});
expect(fieldCardStyle).toEqual({ background: "rgb(255, 255, 255)", shadow: "none" });

const fieldTable = await fieldCard.locator(".markdown-table-scroll").evaluate((wrapper) => ({
  overflowX: getComputedStyle(wrapper).overflowX,
  clientWidth: wrapper.clientWidth,
  scrollWidth: wrapper.scrollWidth
}));
expect(fieldTable.overflowX).toBe("auto");
expect(fieldTable.scrollWidth).toBeGreaterThan(fieldTable.clientWidth);
await page.screenshot({ path: testInfo.outputPath("field-document-desktop.png"), fullPage: true });

await host.locator("[data-tab='api-doc']").click();
const codeBlock = apiCard.locator("pre");
expect(await codeBlock.evaluate((pre) => getComputedStyle(pre).overflowX)).toBe("auto");
await page.screenshot({ path: testInfo.outputPath("api-document-desktop.png"), fullPage: true });

const overflow = await host.locator("[data-role='drawer']").evaluate((drawer) => ({
  drawerClientWidth: drawer.clientWidth,
  drawerScrollWidth: drawer.scrollWidth,
  pageClientWidth: document.documentElement.clientWidth,
  pageScrollWidth: document.documentElement.scrollWidth
}));
expect(overflow.drawerScrollWidth).toBeLessThanOrEqual(overflow.drawerClientWidth);
expect(overflow.pageScrollWidth).toBeLessThanOrEqual(overflow.pageClientWidth);
```

In the existing `page-scoped documents and global hub stay isolated and reachable` test, after verifying the four hub categories, add:

```js
const hubCardStyles = await host.locator("[data-hub-category]").evaluateAll((cards) => cards.map((card) => {
  const style = getComputedStyle(card);
  return {
    background: style.backgroundColor,
    shadow: style.boxShadow,
    minHeight: style.minHeight
  };
}));
expect(hubCardStyles).toHaveLength(4);
expect(hubCardStyles.every((style) => (
  style.background === "rgb(255, 255, 255)"
  && style.shadow === "none"
  && style.minHeight === "96px"
))).toBe(true);
```

- [ ] **Step 8: Run browser readability and interaction verification**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "readable field and API Markdown|page-scoped documents and global hub|Drawer tabs show one document group"
```

Expected: all tests pass; typography computes to `15px/26.25px`, H2 has a divider, table and code overflow are local, the Drawer and page do not overflow, four Related-document cards are white and flat, unsafe Markdown remains inert, and all panel/hub interactions still work.

- [ ] **Step 9: Commit the independently verified document visual system**

```powershell
git add tests/unit/drawer-tabs.test.js tests/e2e/prd-annotator.spec.js prd-annotator/src/ui/styles.js
git commit -m "style: improve Drawer document readability"
```

Expected: a local commit succeeds with presentation and regression-test changes only.

---

### Task 4: Rebuild the Single-file SDK and Run Every Gate

**Files:**
- Modify: `prd-annotator/prd-annotator.js`
- Verify only: `package.json`, `prd-annotator-skill/`, `tests/fixtures/project/`, tracked repository files, and the complete diff.

**Interfaces:**
- Consumes: Tested source CSS from Tasks 1-3 and the existing `npm run build` pipeline.
- Produces: A regenerated single-file `prd-annotator.js` at version `2.5.1`, with unit, browser, repository, project, Skill, path, encoding, and diff evidence.

- [ ] **Step 1: Rebuild from source**

Run:

```powershell
npm run build
```

Expected: the build exits `0`, updates only the generated `prd-annotator/prd-annotator.js` artifact as needed, and keeps the banner/package version `2.5.1`.

- [ ] **Step 2: Run all unit tests**

Run:

```powershell
npm run test:unit
```

Expected: the complete Vitest suite passes; the pre-feature baseline was `908 passed, 2 skipped`, and the pass count increases only by the new tests.

- [ ] **Step 3: Run the complete browser suite**

Run:

```powershell
npm run test:e2e
```

Expected: every Playwright scenario passes, including all pre-existing 19 scenarios plus the new desktop responsive scenario. Inspect the generated screenshots for long Page PRD content, the wide Field table, API table/code, Related-document entries, and `390px` mobile layout. Confirm header/Tabs stay sticky without covering content and the Page PRD secondary switch scrolls away with the document.

- [ ] **Step 4: Run repository, project, and Skill gates**

Run:

```powershell
npm run check:repo
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
& 'C:\Users\28920\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 'C:\Users\28920\.codex\skills\.system\skill-creator\scripts\quick_validate.py' 'D:\Codexdoc\My\project_prdjs\code\prd-annotator-skill'
```

Expected: repository policy passes with ASCII tracked paths and no runtime save service or destructive workflow; the fixture project gate passes; the Skill validator reports a valid Skill.

- [ ] **Step 5: Run diff and UTF-8-without-BOM gates**

Run:

```powershell
git diff --check
$pathsToCheck = @(git ls-files) + @(git ls-files --others --exclude-standard)
$badBom = $pathsToCheck | Sort-Object -Unique | ForEach-Object {
  $absolutePath = Join-Path (Get-Location) $_
  $bytes = [System.IO.File]::ReadAllBytes($absolutePath)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $_ }
}
if ($badBom) { $badBom; throw 'Tracked UTF-8 BOM detected' }
Write-Output 'Tracked-file BOM check passed'
```

Expected: `git diff --check` emits no errors and the BOM scan prints `Tracked-file BOM check passed`; tracked and newly created untracked files are both covered.

- [ ] **Step 6: Inspect exact scope and generated/source parity**

Run:

```powershell
git status --short
git diff --stat
git diff -- tests/unit/drawer-tabs.test.js tests/e2e/prd-annotator.spec.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js
git diff -- package.json prd-annotator-skill
```

Expected: implementation changes are limited to the two tests, source CSS, generated SDK, and this plan/spec history; `package.json` and `prd-annotator-skill/` have no diff; no annotation, document, View, route, storage, or synchronization file changed.

- [ ] **Step 7: Perform a fresh requirements review**

Check all of the following against the actual browser, not only source text:

- `1280px`, `1440px`, `1920px`: Drawer width follows `clamp(720px, 56vw, 900px)`; five Tabs show fully on one row; `scrollWidth <= clientWidth`.
- Intermediate width below `720px`: Drawer fits the viewport and remains attached to the right.
- `390px`: full-screen Drawer, Tab horizontal-scroll fallback, one visible panel, and no page/Drawer overflow.
- Header and primary Tabs remain sticky; secondary Page PRD switch remains normal-flow.
- Four document panels are centered with `800px` maximum; annotations have no max-width or card redesign.
- Long PRD hierarchy, multilevel lists, Field table, API table/code, warnings, empty states, and Related-document cards are readable.
- Content, document selection/scope/order, annotations, data, and all interactions are unchanged.

Expected: every item is confirmed with no unreviewed discrepancy.

- [ ] **Step 8: Commit the regenerated SDK and verification-ready state locally**

Run:

```powershell
git add prd-annotator/prd-annotator.js docs/superpowers/plans/2026-08-12-wide-drawer-document-reading.md
git commit -m "build: regenerate wide Drawer SDK"
git status --short --branch
```

Expected: the local `master` working tree is clean and ahead of `origin/master`; do not push, tag, publish a Release, change version, or update the global Skill.

## Self-Review

- Spec coverage: Task 1 covers responsive Drawer geometry, sticky full-width desktop Tabs, one-row/no-overflow checks at all three desktop widths, intermediate fitting, and the mobile scroll fallback. Task 2 restricts the centered `800px` measure to exactly the four document panels and preserves the annotation/secondary-switch boundaries. Task 3 covers document surfaces, header hierarchy, typography, H1-H6, lists, tables, code, blockquotes, warnings, empty states, Related-document cards, wrapping, local overflow, Markdown safety, and unchanged interaction. Task 4 covers generation plus all required repository, project, Skill, ASCII, UTF-8-without-BOM, diff, desktop, intermediate, and mobile gates.
- Placeholder scan: the plan contains no deferred implementation markers, unspecified error handling, generic “write tests” steps, or cross-task “same as above” shortcuts. Every mutation names exact selectors, files, commands, expected RED/GREEN behavior, and commit scope.
- Type and selector consistency: all selectors already exist in `shell.js`, `drawer.js`, and Markdown output except the planned media query; panel names exactly match `annotations`, `page-prd`, `field-spec`, `api-doc`, and `related`; no runtime method, schema field, document type, or public API is introduced or renamed.
- Boundary review: implementation is CSS-focused. JavaScript changes are limited to regression tests, the SDK is rebuilt rather than hand-edited, version remains `2.5.1`, and no publishing/global-Skill action is authorized by this plan.
