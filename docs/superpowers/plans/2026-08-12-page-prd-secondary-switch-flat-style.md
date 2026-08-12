# Page PRD Secondary Switch Flat Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Page PRD / Current-page supplements` secondary switch scroll as a flat inline control without changing the Drawer tabs or any data behavior.

**Architecture:** Keep the existing secondary-switch markup, selection state, and keyboard handlers unchanged. Lock the visual contract in the Drawer unit test, then make a narrowly scoped CSS change and rebuild the generated single-file SDK from source.

**Tech Stack:** JavaScript, CSS-in-JS template string, Vitest with jsdom, esbuild, Playwright.

## Global Constraints

- Change only the SDK presentation styles and their regression coverage.
- Remove sticky positioning, `top`, stacking, shadow, translation, transition, and animation from the Page PRD secondary switch.
- Preserve its border, selected background, count, selection behavior, and keyboard behavior.
- Preserve the five top-level sticky Drawer Tabs unchanged.
- Keep package and SDK version `2.5.0`.
- Keep tracked paths ASCII-only and text UTF-8 without BOM.
- Do not push, publish a Release, or update the installed global Skill without separate authorization.

## File Structure

- `tests/unit/drawer-tabs.test.js` — regression contract for placement, normal scrolling, and flat button presentation.
- `prd-annotator/src/ui/styles.js` — source CSS for the secondary switch.
- `prd-annotator/prd-annotator.js` — generated single-file SDK rebuilt from source.

---

### Task 1: Flatten the Page PRD secondary switch

**Files:**
- Modify: `tests/unit/drawer-tabs.test.js:76-87`
- Modify: `prd-annotator/src/ui/styles.js:408-429`
- Modify: `prd-annotator/prd-annotator.js`

**Interfaces:**
- Consumes: Existing `[data-role='page-prd-switcher']` markup and `.page-document-switcher` class.
- Produces: The same interactive secondary switch with normal document flow and explicitly flat button styling.

- [ ] **Step 1: Write the failing flat-style regression test**

Replace the existing `places the page PRD secondary switch before long content and keeps it sticky` test with:

```js
it("places the page PRD secondary switch before long content as a flat inline control", () => {
  const shell = createShell(document);
  document.body.append(shell.host);
  const switcher = shell.shadow.querySelector("[data-role='page-prd-switcher']");
  const content = shell.shadow.querySelector("[data-role='prd-content']");
  const switcherRule = styles.match(/\.page-document-switcher\s*\{([^}]*)\}/)?.[1] ?? "";
  const buttonRule = styles.match(/\.page-document-switcher button\s*\{([^}]*)\}/)?.[1] ?? "";

  expect(switcher).toBeTruthy();
  expect(switcher.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(switcherRule).not.toMatch(/\bposition\s*:\s*sticky\b/);
  expect(switcherRule).not.toMatch(/\btop\s*:/);
  expect(switcherRule).not.toMatch(/\bz-index\s*:/);
  expect(buttonRule).toMatch(/box-shadow\s*:\s*none/);
  expect(buttonRule).toMatch(/transform\s*:\s*none/);
  expect(buttonRule).toMatch(/transition\s*:\s*none/);
  expect(buttonRule).toMatch(/animation\s*:\s*none/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js -t "flat inline control"
```

Expected: FAIL because `.page-document-switcher` is still sticky and its button rule does not explicitly remove shadow, transform, transition, or animation.

- [ ] **Step 3: Implement the minimal flat CSS**

Replace the `.page-document-switcher` and base button rules with:

```css
.page-document-switcher {
  display: flex;
  gap: 8px;
  margin: 0 0 12px;
}

.page-document-switcher button {
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
  box-shadow: none;
  transform: none;
  transition: none;
  animation: none;
}
```

Keep the existing `[aria-selected="true"]` rule unchanged. Do not modify `.drawer-tabs` or any JavaScript behavior.

- [ ] **Step 4: Run focused unit verification and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/drawer-tabs.test.js
```

Expected: all Drawer Tab tests pass, including top-level sticky navigation, secondary selection, keyboard handling, and the new flat-style contract.

- [ ] **Step 5: Rebuild the SDK and run relevant regression tests**

Run:

```powershell
npm run build
npx vitest run tests/unit/drawer-tabs.test.js tests/unit/prd-drawer.test.js tests/unit/document-hub.test.js tests/unit/route-switching.test.js tests/unit/lifecycle.test.js
```

Expected: build exits 0 and all relevant tests pass.

- [ ] **Step 6: Verify the browser presentation**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js
```

Open the fixture in a narrow Drawer and confirm that the secondary switch appears before the PRD content, scrolls away with it, has no shadow or motion, and the five top-level tabs remain sticky.

Expected: all browser scenarios pass and visual inspection matches the approved design.

- [ ] **Step 7: Run final repository gates**

Run:

```powershell
npm run test:unit
npm run build
npm run check:repo
node prd-annotator-skill/scripts/check-project.mjs --project-root tests/fixtures/project
& 'C:\Users\28920\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 'C:\Users\28920\.codex\skills\.system\skill-creator\scripts\quick_validate.py' 'D:\Codexdoc\My\project_prdjs\code\prd-annotator-skill'
git diff --check
```

Then inspect every tracked file byte prefix and require that none starts with UTF-8 BOM bytes `EF BB BF`. Expected: all tests, build, repository gate, fixture project gate, Skill validation, diff check, ASCII path policy, and BOM check pass.

- [ ] **Step 8: Review scope and commit locally**

Run:

```powershell
git diff -- tests/unit/drawer-tabs.test.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js
git status --short
git add tests/unit/drawer-tabs.test.js prd-annotator/src/ui/styles.js prd-annotator/prd-annotator.js docs/superpowers/plans/2026-08-12-page-prd-secondary-switch-flat-style.md
git commit -m "style: flatten page PRD secondary switch"
```

Expected: the diff contains only the plan, source CSS, regression test, and generated SDK; the commit succeeds locally without push or Release work.

## Self-Review

- Spec coverage: Task 1 covers normal scrolling, flat presentation, preserved top-level sticky tabs, unchanged behavior, SDK rebuild, narrow-Drawer browser verification, version retention, and no publishing.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified test steps.
- Type consistency: all selectors match the existing `.page-document-switcher` and `[data-role='page-prd-switcher']` interfaces; no new runtime API is introduced.
