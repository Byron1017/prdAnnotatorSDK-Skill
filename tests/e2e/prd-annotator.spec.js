import { expect, test } from "@playwright/test";

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

test("annotates, persists, displays PRD, and unmounts without data loss", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");
  const tools = host.locator("[data-role='tool-button']");

  await expect(tools).toHaveCount(2);
  await expect(tools.nth(0)).toContainText("标注模式");
  await expect(tools.nth(1)).toContainText("PRD 标注");

  await tools.nth(0).click();
  await page.locator("[data-demo='device-table']").click();
  await host.locator("[data-field='comment']").fill("批量停用需要二次确认");
  await host.locator("[data-action='save-annotation']").click();
  await tools.nth(1).click();
  await expect(host.locator("[data-role='annotation-list']"))
    .toContainText("批量停用需要二次确认");
  await expect(host.locator("[data-role='prd-content']"))
    .toContainText("设备运维页面 PRD");

  const before = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  await page.evaluate(() => window.PRDAnnotator.unmount());
  await expect(page.locator("[data-prd-annotator-ui='host']")).toHaveCount(0);
  const after = await page.evaluate(() => window.PRDAnnotator.getSnapshot());
  expect(after).toEqual(before);
});

test("keeps two pages isolated", async ({ page }) => {
  await page.goto("/examples/device-ops/index.html");
  const firstId = await page.evaluate(() => window.PRDAnnotator.getPageId());

  await page.goto("/examples/device-ops/second-page.html");
  const secondId = await page.evaluate(() => window.PRDAnnotator.getPageId());

  expect(secondId).not.toBe(firstId);
});

test("keeps the unified Drawer inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples/device-ops/index.html");
  const host = page.locator("[data-prd-annotator-ui='host']");

  await host.locator("[data-action='toggle-drawer']").click();
  const drawerBox = await host.locator("[data-role='drawer']").boundingBox();
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
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
  expect(drawerBox.width).toBeLessThanOrEqual(390);
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
  await host.locator("[data-field='comment']").fill("刷新后仍要保留这条标注");
  await host.locator("[data-action='save-annotation']").click();

  await page.reload();
  const reloadedHost = page.locator("[data-prd-annotator-ui='host']");
  await reloadedHost.locator("[data-action='toggle-drawer']").click();
  await expect(reloadedHost.locator("[data-role='annotation-list']"))
    .toContainText("刷新后仍要保留这条标注");
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

  expect(snapshot.document.annotations.some((item) => item.id === "A999"))
    .toBe(true);
  await expect(page.locator(".annotation-marker[data-annotation-id='A999']"))
    .toHaveCount(0);
});
