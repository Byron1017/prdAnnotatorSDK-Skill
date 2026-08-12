### Task 6: Verify real Drawer documents, validate the Skill, and rebuild the SDK

**Files:**
- Modify: `tests/e2e/prd-annotator.spec.js`
- Modify: `prd-annotator/prd-annotator.js` through the build only

**Interfaces:**
- Consumes: safe Markdown parser, document View bundle, and all Skill references.
- Produces: browser-verified document tabs and a validated distributable source tree.

- [ ] **Step 1: Add an end-to-end document readability and security case**

Append this Playwright test to `tests/e2e/prd-annotator.spec.js`:

```js
test("renders readable field and API Markdown without executing source HTML", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await page.evaluate(() => {
    const snapshot = window.PRDAnnotator.getSnapshot();
    const documentEntry = (id, title, kind, displayGroups, content) => ({
      id,
      title,
      path: `doc/${id}.md`,
      format: "markdown",
      kind,
      displayGroups,
      pageIds: [snapshot.document.page.id],
      fingerprint: `sha256:${"a".repeat(64)}`,
      previewStatus: "available",
      missing: false,
      content
    });
    window.PRDAnnotator.hydrateView({
      schemaVersion: 2,
      generatedAt: "2026-08-11T10:00:00.000Z",
      projectId: snapshot.document.projectId,
      page: snapshot.document.page,
      persistedAnnotationFingerprint: snapshot.annotationFingerprint,
      document: snapshot.document,
      documents: [
        documentEntry(
          "field-spec-test",
          "Message Fields",
          "field-spec",
          ["field-spec"],
          "# Fields\n\n| Field | Type | Required |\n|---|---|---|\n| `id` | `string` | Yes |"
        ),
        documentEntry(
          "api-doc-test",
          "Message API",
          "api-doc",
          ["api-doc"],
          "# API\n\n| Method | Path | Purpose |\n|---|---|---|\n| `GET` | `/messages` | List messages |\n\n[unsafe](javascript:window.hacked=true)\n\n<script>window.hacked=true</script>"
        )
      ]
    });
  });

  await host.locator("[data-action='toggle-drawer']").click();
  await host.locator("[data-tab='field-spec']").click();
  const fieldCard = host.locator("[data-document-id='field-spec-test']");
  await expect(fieldCard.locator(".markdown-table-scroll table")).toHaveCount(1);
  await expect(fieldCard.locator("code").first()).toHaveText("id");

  await host.locator("[data-tab='api-doc']").click();
  const apiCard = host.locator("[data-document-id='api-doc-test']");
  await expect(apiCard.locator("tbody tr")).toHaveCount(1);
  await expect(apiCard.locator("script")).toHaveCount(0);
  await expect(apiCard.locator("a")).toHaveCount(0);
  await expect(apiCard).toContainText("<script>");
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused end-to-end case**

Run:

```powershell
npx playwright test tests/e2e/prd-annotator.spec.js --grep "readable field and API Markdown"
```

Expected: PASS.

- [ ] **Step 3: Validate the Skill folder**

Run:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" prd-annotator-skill
```

Expected: the validator reports that `prd-annotator-skill` is valid. If the machine exposes Python only as `py`, run the same file with `py` and require the same successful validation output; do not modify the Skill to work around a missing interpreter.

- [ ] **Step 4: Run complete unit tests**

Run:

```powershell
npm run test:unit
```

Expected: all Vitest files PASS.

- [ ] **Step 5: Rebuild the single-file SDK**

Run:

```powershell
npm run build
```

Expected: exit code 0; `prd-annotator/prd-annotator.js` contains `markdown-table-scroll`, `markdown-inline-code`, and the safe protocol checks.

- [ ] **Step 6: Run full browser and repository verification**

Run:

```powershell
npm run test:e2e
npm run check:repo
git diff --check
```

Expected: all Playwright tests PASS, repository policy check exits 0, and `git diff --check` prints no errors.

- [ ] **Step 7: Commit the verified integration**

```powershell
git add tests/e2e/prd-annotator.spec.js prd-annotator/prd-annotator.js
git commit -m "test: verify document rendering integration"
```

- [ ] **Step 8: Confirm the worktree contains no unintended changes**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected: no uncommitted files from this plan; recent history contains inline Markdown, tables, document control plane, PRD references, field/API references, and integration verification commits.
