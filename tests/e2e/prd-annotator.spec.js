import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const payloadStartMarker = "---PRD_ANNOTATOR_PAYLOAD_START---";
const payloadEndMarker = "---PRD_ANNOTATOR_PAYLOAD_END---";
const localScriptRestrictionPattern = /ERR_ACCESS_DENIED|not allowed to load local resource|blocked by (?:CORS|cross-origin)|cross origin requests are only supported/i;

const runtimeErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});

function annotatorHost(page) {
  return page.locator("[data-prd-annotator-ui='host']");
}

async function openDrawer(page) {
  const host = annotatorHost(page);
  const button = host.locator("[data-action='toggle-drawer']");
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  return host;
}

async function createAnnotation(page, title) {
  const host = annotatorHost(page);
  const annotationButton = host.locator("[data-action='toggle-annotation']");
  if (await annotationButton.getAttribute("aria-pressed") !== "true") {
    await annotationButton.click();
  }
  await page.locator("main").click();
  await host.locator("[data-field='title']").fill(title);
  await host.locator("[data-field='description']").fill(title);
  await host.locator("[data-field='prdContent']").fill(title);
  await host.locator("[data-action='save-annotation']").click();
}

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

test("recognizes only concrete local-file restrictions for capability skips", () => {
  expect(localScriptRestrictionPattern.test("net::ERR_ACCESS_DENIED")).toBe(true);
  expect(localScriptRestrictionPattern.test(
    "Not allowed to load local resource: file:///prototype/prd-annotator.js"
  )).toBe(true);
  expect(localScriptRestrictionPattern.test(
    "Access to script at file:///prototype/view.js was blocked by CORS policy"
  )).toBe(true);
  expect(localScriptRestrictionPattern.test("net::ERR_BLOCKED_BY_CLIENT")).toBe(false);
});

test("Hash routes isolate one physical HTML across dynamic values", async ({ page }) => {
  await page.goto("/examples/device-ops/hash-router.html#/message/edit/123?tab=base");
  await page.evaluate(() => window.PRDAnnotatorReady);
  await expect(annotatorHost(page).locator("[data-role='tool-button']")).toHaveCount(2);
  expect(await page.evaluate(() => window.PRDAnnotator.getPageId())).toBe("message-edit");

  await createAnnotation(page, "Edit only");
  let host = await openDrawer(page);
  await expect(host.locator("[data-role='annotation-list']")).toContainText("Edit only");
  await host.locator("[data-tab='page-prd']").click();
  await expect(host.locator("[data-document-id='doc-message-edit-prd']"))
    .toContainText("消息编辑页面 PRD");

  await page.evaluate(() => { window.location.hash = "#/message/list?page=2"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
    .toBe("message-list");
  host = await openDrawer(page);
  await expect(host.locator("[data-role='annotation-list']")).not.toContainText("Edit only");

  await page.evaluate(() => { window.location.hash = "#/message/edit/456?tab=other"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
    .toBe("message-edit");
  host = await openDrawer(page);
  await expect(host.locator("[data-role='annotation-list']")).toContainText("Edit only");

  await deleteAnnotation(page, "A001", { confirm: true });
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.deletedAnnotations.map(({ id }) => id)
  )).toEqual(["A001"]);
  await page.evaluate(() => { window.location.hash = "#/message/list"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
    .toBe("message-list");
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.deletedAnnotations
  )).toEqual([]);
});

test("Hash routes ignore queries, preserve anchors, and quarantine unknown routes", async ({ page }) => {
  await page.goto("/examples/device-ops/hash-router.html#/message/list?page=1");
  await page.evaluate(() => window.PRDAnnotatorReady);
  expect(await page.evaluate(() => window.PRDAnnotator.getPageId())).toBe("message-list");

  await page.evaluate(() => { window.location.hash = "#/message/list?page=9"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
    .toBe("message-list");

  await page.evaluate(() => { window.location.hash = "#section"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getPageId()))
    .toBe("hash-router-base");

  await page.evaluate(() => { window.location.hash = "#/unregistered/7?from=direct"; });
  await expect.poll(() => page.evaluate(() => window.PRDAnnotator.getSnapshot().locationIdentity.registered))
    .toBe(false);
  const unknownId = await page.evaluate(() => window.PRDAnnotator.getPageId());
  expect(unknownId).toMatch(/^unknown-[a-f0-9]{6}$/);
  const host = await openDrawer(page);
  await expect(host.locator("[data-role='view-warning']"))
    .toContainText("需要 AI Agent 重新生成本页展示数据");
  await expect(host.locator("[data-document-id='doc-message-list-prd']")).toHaveCount(0);
  await expect(host.locator("[data-document-id='doc-message-edit-prd']")).toHaveCount(0);
});

test("Drawer tabs show one document group at a time on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/device-ops/hash-router.html#/message/list");
  await page.evaluate(() => window.PRDAnnotatorReady);
  const host = await openDrawer(page);
  const tabs = host.locator("[role='tab']");

  await expect(tabs).toHaveCount(5);
  await expect(host.locator("[role='tabpanel']:not([hidden])")).toHaveCount(1);
  await expect(host.locator("[data-panel='annotations']")).toBeVisible();

  await host.locator("[data-tab='page-prd']").click();
  await expect(host.locator("[data-panel='page-prd']")).toBeVisible();
  await expect(host.locator("[data-document-id='doc-message-list-prd']"))
    .toContainText("消息列表页面 PRD");

  await host.locator("[data-tab='field-spec']").click();
  await expect(host.locator("[data-panel='field-spec']")).toBeVisible();
  await expect(host.locator("[data-document-id='doc-message-fields']"))
    .toContainText("消息字段规范");

  await host.locator("[data-tab='api-doc']").scrollIntoViewIfNeeded();
  await host.locator("[data-tab='api-doc']").click();
  await expect(host.locator("[data-panel='api-doc']")).toBeVisible();
  await expect(host.locator("[data-document-id='doc-message-api']"))
    .toContainText("消息接口文档");

  await host.locator("[data-tab='related']").click();
  await expect(host.locator("[data-panel='related']")).toBeVisible();
  await expect(host.locator("[data-document-id='doc-message-total']"))
    .toContainText("消息中心总 PRD");
  expect(await host.locator("[role='tablist']").evaluate((element) => getComputedStyle(element).overflowX))
    .toBe("auto");
});

test("shows exactly two tools, all documents, and a synchronized empty state", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);
  await host.locator("[data-action='toggle-drawer']").click();
  const initialSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(initialSnapshot.document.annotations).toHaveLength(0);
  await expect(host.locator("[data-role='annotation-list'] li")).toHaveCount(0);
  await expect(host.locator("[data-role='annotation-list']"))
    .toContainText("本页还没有标注");
  await expect(host.locator("[data-document-id='doc-page-primary']"))
    .toContainText("设备运维页面 PRD");
  await expect(host.locator("[data-document-id='doc-page-alternate']"))
    .toContainText("备选页面 PRD");
  await expect(host.locator("[data-document-id='doc-total']"))
    .toContainText("产品总 PRD");
  await expect(host.locator("[data-document-id='doc-legacy-pdf']"))
    .toContainText("历史需求 PDF");
  await expect(host.locator("[data-document-id='doc-legacy-pdf']"))
    .toContainText("预览：暂不可预览");
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
  const annotationValues = {
    title: "批量停用",
    description: "增加批量停用入口",
    type: "requirement",
    prdContent: "选中设备后可以批量停用",
    note: "提交前二次确认；deviceIds、disabledReason；POST /api/devices/batch-disable；已停用设备不可重复提交"
  };
  await host.locator("[data-action='toggle-annotation']").click();
  await page.locator("[data-demo='device-table']").click();
  await host.locator("[data-field='title']").fill(annotationValues.title);
  await host.locator("[data-field='description']").fill(annotationValues.description);
  await host.locator("[data-field='type']").selectOption(annotationValues.type);
  await host.locator("[data-field='prdContent']").fill(annotationValues.prdContent);
  await host.locator("[data-field='note']").fill(annotationValues.note);
  await host.locator("[data-action='save-annotation']").click();

  const savedSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(savedSnapshot.document.annotations).toHaveLength(1);
  expect(savedSnapshot.document.annotations[0]).toMatchObject(annotationValues);
  for (const retiredProperty of [
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ]) {
    expect(Object.hasOwn(savedSnapshot.document.annotations[0], retiredProperty)).toBe(false);
  }

  await page.reload();
  await host.locator("[data-action='toggle-drawer']").click();
  const renderedAnnotation = host.locator("[data-role='annotation-list']");
  await expect(renderedAnnotation).toContainText(annotationValues.title);
  await expect(renderedAnnotation).toContainText(annotationValues.description);
  await expect(renderedAnnotation).toContainText(annotationValues.prdContent);
  await expect(renderedAnnotation).toContainText(annotationValues.note);

  const reloadedSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(reloadedSnapshot.document.annotations[0]).toMatchObject(annotationValues);
  expect(reloadedSnapshot.document.annotations[0].note).toBe(annotationValues.note);
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

  await expect(host.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "browser-only");
  await host.locator("[data-action='copy-sync-prompt']").click();
  const copiedPrompt = await page.evaluate(() => window.__copiedSyncPrompt);
  expect(copiedPrompt).toContain(payloadStartMarker);
  expect(copiedPrompt).toContain(payloadEndMarker);
  const payloadStart = copiedPrompt.indexOf(payloadStartMarker) + payloadStartMarker.length;
  const payloadEnd = copiedPrompt.indexOf(payloadEndMarker, payloadStart);
  expect(payloadEnd).toBeGreaterThan(payloadStart);
  const payload = JSON.parse(copiedPrompt.slice(payloadStart, payloadEnd).trim());
  expect(payload.projectId).toBe("device-demo-a13f92");
  expect(payload.pageId).toBe("equipment-ops-7c31fa");
  expect(payload.document.projectId).toBe("device-demo-a13f92");
  expect(payload.document.page.id).toBe("equipment-ops-7c31fa");
  expect(payload.document.page.htmlPath).toBe("examples/device-ops/index.html");
  expect(payload.document).toEqual(reloadedSnapshot.document);
  expect(payload.document.annotations).toHaveLength(1);
  expect(payload.document.annotations[0]).toMatchObject(annotationValues);
  expect(payload.document.annotations[0].note).toBe(annotationValues.note);
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
  const localScriptFailures = [];
  const localRestrictionMessages = [];
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith("file:") || !request.url().endsWith(".js")) return;
    localScriptFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText || ""
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && localScriptRestrictionPattern.test(message.text())) {
      localRestrictionMessages.push(message.text());
    }
  });
  const fileUrl = pathToFileURL(
    path.join(repositoryRoot, "examples/device-ops/index.html")
  ).href;
  await page.goto(fileUrl);
  const sdkLoaded = await page.waitForFunction(
    () => Boolean(window.PRDAnnotator),
    undefined,
    { timeout: 2_000 }
  ).then(() => true, () => false);
  if (!sdkLoaded) {
    expect(localScriptFailures.some(({ url }) => url.endsWith("prd-annotator.js")))
      .toBe(true);
    expect([
      ...localScriptFailures.map(({ errorText }) => errorText),
      ...localRestrictionMessages
    ].some((message) => localScriptRestrictionPattern.test(message))).toBe(true);
    runtimeErrors.set(page, runtimeErrors.get(page)
      .filter((message) => !localScriptRestrictionPattern.test(message)));
    test.skip(true, "Chromium reported a concrete local SDK sibling-script restriction");
  }
  const host = page.locator("[data-prd-annotator-ui='host']");
  const viewLoaded = await host.locator("[data-document-id='doc-page-primary']")
    .waitFor({ state: "attached", timeout: 2_000 })
    .then(() => true, () => false);
  if (!viewLoaded) {
    expect(localScriptFailures.some(({ url }) => url.endsWith("equipment-ops-view.js")))
      .toBe(true);
    expect([
      ...localScriptFailures.map(({ errorText }) => errorText),
      ...localRestrictionMessages
    ].some((message) => localScriptRestrictionPattern.test(message))).toBe(true);
    runtimeErrors.set(page, runtimeErrors.get(page)
      .filter((message) => !localScriptRestrictionPattern.test(message)));
    test.skip(true, "Chromium reported a concrete local view-script restriction");
  }
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);
  await host.locator("[data-action='toggle-drawer']").click();
  await expect(host.locator("[data-document-id='doc-page-primary']"))
    .toContainText("设备运维页面 PRD");
});

test("annotates, persists, displays PRD, and unmounts without data loss", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  const tools = host.locator("[data-role='tool-button']");

  await expect(tools).toHaveCount(2);
  await expect(tools.nth(0)).toContainText("标注模式");
  await expect(tools.nth(1)).toContainText("PRD 标注");

  await tools.nth(0).click();
  await page.locator("[data-demo='device-table']").click();
  await host.locator("[data-field='title']").fill("批量停用");
  await host.locator("[data-field='description']").fill("批量停用需要二次确认");
  await host.locator("[data-field='type']").selectOption("requirement");
  await host.locator("[data-field='prdContent']").fill("选中设备后可以批量停用");
  await host.locator("[data-field='note']").fill("提交前二次确认");
  await host.locator("[data-action='save-annotation']").click();
  await tools.nth(1).click();
  await expect(host.locator("[data-role='annotation-list']"))
    .toContainText("批量停用");
  await expect(host.locator("[data-document-id='doc-page-primary']"))
    .toContainText("设备运维页面 PRD");

  const before = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  await page.evaluate(() => window.PRDAnnotator.unmount());
  await expect(page.locator("[data-prd-annotator-ui='host']")).toHaveCount(0);
  const after = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(after).toEqual(before);
});

test("edits and explicitly deletes annotations without renumbering", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  await page.evaluate(() => window.PRDAnnotatorReady);
  await createAnnotation(page, "First");
  await createAnnotation(page, "Second");
  await createAnnotation(page, "Third");

  const host = await openDrawer(page);
  await editAnnotation(page, "A002", "Second edited");
  const secondCard = host.locator("li[data-annotation-id='A002']");
  await expect(secondCard).toContainText("Second edited");

  await deleteAnnotation(page, "A002", { confirm: false });
  await expect(secondCard).toHaveCount(1);
  await deleteAnnotation(page, "A002", { confirm: true });
  await expect(secondCard).toHaveCount(0);
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

test("keeps two pages isolated", async ({ page }) => {
  const isolatedAnnotationTitle = "仅设备页保留";
  await page.goto("/examples/device-ops/index.html");
  const firstHost = page.locator("[data-prd-annotator-ui='host']");
  const firstId = await page.evaluate(() => window.PRDAnnotator.getPageId());
  await firstHost.locator("[data-action='toggle-annotation']").click();
  await page.locator("[data-demo='device-table']").click();
  await firstHost.locator("[data-field='title']").fill(isolatedAnnotationTitle);
  await firstHost.locator("[data-field='description']")
    .fill("该标注不得出现在维保记录页");
  await firstHost.locator("[data-field='type']").selectOption("requirement");
  await firstHost.locator("[data-field='prdContent']")
    .fill("设备页的批量操作需求");
  await firstHost.locator("[data-action='save-annotation']").click();
  const firstSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(firstSnapshot.document.annotations).toHaveLength(1);
  expect(firstSnapshot.document.annotations[0].title).toBe(isolatedAnnotationTitle);
  await expect(firstHost.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "browser-only");

  await page.goto("/examples/device-ops/second-page.html");
  const secondId = await page.evaluate(() => window.PRDAnnotator.getPageId());
  const secondHost = page.locator("[data-prd-annotator-ui='host']");
  const secondSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(secondSnapshot.document.annotations).toHaveLength(0);
  expect(secondSnapshot.document.annotations.some(
    (annotation) => annotation.title === isolatedAnnotationTitle
  )).toBe(false);
  await secondHost.locator("[data-action='toggle-drawer']").click();
  await expect(secondHost.locator("[data-role='annotation-list'] li")).toHaveCount(0);
  await expect(secondHost.locator("[data-role='annotation-list']"))
    .not.toContainText(isolatedAnnotationTitle);
  await expect(secondHost.locator("[data-document-id='doc-maintenance']"))
    .toContainText("维保记录页面 PRD");
  await expect(secondHost.locator("[data-document-id='doc-total']"))
    .toContainText("产品总 PRD");

  expect(secondId).not.toBe(firstId);

  await page.goto("/examples/device-ops/index.html");
  const returnedHost = page.locator("[data-prd-annotator-ui='host']");
  const returnedSnapshot = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(returnedSnapshot.document.annotations).toHaveLength(1);
  expect(returnedSnapshot.document.annotations[0].title).toBe(isolatedAnnotationTitle);
  await returnedHost.locator("[data-action='toggle-drawer']").click();
  await expect(returnedHost.locator("[data-role='annotation-list']"))
    .toContainText(isolatedAnnotationTitle);
  await expect(returnedHost.locator("[data-role='sync-state']"))
    .toHaveAttribute("data-state", "browser-only");

  await deleteAnnotation(page, "A001", { confirm: true });
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.deletedAnnotations.map(({ id }) => id)
  )).toEqual(["A001"]);
  await page.goto("/examples/device-ops/second-page.html");
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.deletedAnnotations
  )).toEqual([]);
});

test("collapses the launcher across project pages without changing data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/device-ops/index.html");
  let host = annotatorHost(page);
  const actions = host.locator("[data-role='tool-actions']");
  const toggle = host.locator("[data-role='tool-launcher-toggle']");
  const annotationButton = host.locator("[data-action='toggle-annotation']");
  const snapshotBefore = await page.evaluate(
    () => JSON.stringify(window.PRDAnnotator.getSnapshot())
  );
  const promptBefore = await page.evaluate(
    () => window.PRDAnnotator.getSyncPrompt()
  );

  await annotationButton.click();
  await toggle.click();

  await expect(actions).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute(
    "aria-label",
    "展开 PRD 标注工具（标注模式已开启）"
  );
  await expect(annotationButton).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(
    () => JSON.stringify(window.PRDAnnotator.getSnapshot())
  )).toBe(snapshotBefore);
  expect(await page.evaluate(
    () => window.PRDAnnotator.getSyncPrompt()
  )).toBe(promptBefore);

  const handleBox = await toggle.boundingBox();
  expect(handleBox.width).toBeLessThanOrEqual(24);
  expect(handleBox.height).toBe(44);
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  await expect.poll(async () => {
    const settledHandleBox = await toggle.boundingBox();
    return Math.abs(
      viewport.innerWidth - (settledHandleBox.x + settledHandleBox.width)
    );
  }).toBeLessThanOrEqual(0.5);
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);

  await page.reload();
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  await page.goto("/examples/device-ops/second-page.html");
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  await page.goto(
    "/examples/device-ops/hash-router.html#/message/edit/123?tab=base"
  );
  await page.evaluate(() => window.PRDAnnotatorReady);
  host = annotatorHost(page);
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();
  await page.evaluate(() => {
    window.location.hash = "#/message/list?page=2";
  });
  await expect.poll(() => page.evaluate(
    () => window.PRDAnnotator.getPageId()
  )).toBe("message-list");
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();

  const routeToggle = host.locator("[data-role='tool-launcher-toggle']");
  await routeToggle.focus();
  await page.keyboard.press("Space");
  await expect(host.locator("[data-role='tool-actions']")).toBeVisible();
  await expect(routeToggle).toHaveAttribute("aria-expanded", "true");
  await expect(routeToggle).toBeFocused();
  await expect(host.locator("[data-role='tool-button']")).toHaveCount(2);
  const expandedToggleBox = await routeToggle.boundingBox();
  expect(expandedToggleBox.width).toBe(32);
  expect(expandedToggleBox.height).toBe(44);

  await routeToggle.press("Enter");
  await expect(host.locator("[data-role='tool-actions']")).toBeHidden();
  await expect(routeToggle).toHaveAttribute("aria-expanded", "false");
});

test("keeps the unified Drawer inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/device-ops/index.html");
  await page.evaluate(() => {
    document.documentElement.style.scrollbarGutter = "stable";
  });
  const host = page.locator("[data-prd-annotator-ui='host']");

  await host.locator("[data-action='toggle-drawer']").click();
  const drawerBox = await host.locator("[data-role='drawer']").boundingBox();
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowers: [...document.body.querySelectorAll("*")]
      .map((element) => ({
        name: element.className || element.tagName,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        scrollWidth: element.scrollWidth
      }))
      .filter((element) => element.left < 0 || element.right > window.innerWidth)
      .slice(0, 12)
  }));

  expect(drawerBox.x).toBeGreaterThanOrEqual(0);
  expect(drawerBox.width).toBeLessThanOrEqual(viewport.clientWidth);
  expect(
    viewport.scrollWidth,
    `Overflowing elements: ${JSON.stringify(viewport.overflowers)}`
  ).toBeLessThanOrEqual(viewport.innerWidth);
});

test("Escape closes the editor before leaving annotation mode", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  const annotationButton = host.locator("[data-action='toggle-annotation']");

  await annotationButton.click();
  await page.locator("[data-demo='device-table']").click();
  await expect(host.locator("[data-role='editor']")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(host.locator("[data-role='editor']")).toBeHidden();
  await expect(annotationButton).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(annotationButton).toHaveAttribute("aria-pressed", "false");
});

test("SDK controls never create annotations", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  const before = await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.annotations.length
  );

  await host.locator("[data-action='toggle-annotation']").click();
  await host.locator("[data-action='toggle-drawer']").click();
  await host.locator("[data-action='close-drawer']").click();
  await host.locator("[data-action='toggle-annotation']").click();

  const after = await page.evaluate(
    () => window.PRDAnnotator.getSnapshot().document.annotations.length
  );
  expect(after).toBe(before);
});

test("restores a newly saved annotation after refresh", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");

  await host.locator("[data-action='toggle-annotation']").click();
  await page.locator("[data-demo='device-table']").click();
  await host.locator("[data-field='title']").fill("刷新恢复");
  await host.locator("[data-field='description']").fill("刷新后仍要保留这条标注");
  await host.locator("[data-field='type']").selectOption("requirement");
  await host.locator("[data-field='prdContent']").fill("刷新页面后恢复浏览器标注");
  await host.locator("[data-field='note']").fill("刷新后标注仍可见");
  await host.locator("[data-action='save-annotation']").click();

  await page.reload();
  const reloadedHost = page.locator("[data-prd-annotator-ui='host']");
  await reloadedHost.locator("[data-action='toggle-drawer']").click();
  await expect(reloadedHost.locator("[data-role='annotation-list']"))
    .toContainText("刷新恢复");
});

test("exposes no destructive public API", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");

  const prohibited = await page.evaluate(() => Object.keys(window.PRDAnnotator)
    .filter((key) => /purge|clear|reset|delete/i.test(key)));

  expect(prohibited).toEqual([]);
});

test("keeps a stale target descriptor when no marker can render", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");

  const snapshot = await page.evaluate(() => {
    const current = window.PRDAnnotator.getSnapshot();
    window.PRDAnnotator.hydrate({
      document: {
        schemaVersion: 1,
        page: current.document.page,
        annotations: [{
          id: "A999",
          comment: "目标 DOM 已变化，但历史标注必须保留",
          status: "open",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
          target: {
            cssPath: "#definitely-missing-target",
            xpath: "/html/body/main/article[999]",
            textQuote: "THIS TARGET DOES NOT EXIST",
            rect: { x: 0, y: 0, width: 10, height: 10 }
          },
          prd: {
            linkedSections: [],
            impactScope: "page",
            summary: ""
          }
        }]
      }
    });
    return window.PRDAnnotator.getSnapshot();
  });

  const retained = snapshot.document.annotations.find((item) => item.id === "A999");
  expect(retained?.target).toEqual({
    cssPath: "#definitely-missing-target",
    xpath: "/html/body/main/article[999]",
    textQuote: "THIS TARGET DOES NOT EXIST",
    rect: { x: 0, y: 0, width: 10, height: 10 }
  });
  await expect(page.locator(".annotation-marker[data-annotation-id='A999']"))
    .toHaveCount(0);
});
