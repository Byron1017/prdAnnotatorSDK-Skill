import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot } from "../../prd-annotator/src/index.js";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";
import { makeStorageKey } from "../../prd-annotator/src/storage.js";

const projectId = "device-demo-a13f92";
const pageId = "equipment-ops-7c31fa";

function page() {
  return {
    id: pageId,
    title: "Equipment Operations",
    htmlPath: "prototype/index.html",
    route: "/prototype/index.html"
  };
}

function cachedAnnotation() {
  return {
    id: "A001",
    title: "Browser-only annotation",
    description: "Keep this annotation when a view script omits hydration.",
    type: "requirement",
    prdContent: "Keep recovery data.",
    acceptanceCriteria: "",
    dataFields: "",
    apiPath: "",
    edgeCases: "",
    status: "open",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Main",
      rect: { x: 0, y: 0, width: 1, height: 1 }
    },
    prd: { linkedDocuments: [], linkedSections: [], impactScope: "page", summary: "" }
  };
}

describe("view script boot", () => {
  let previousCurrentScript;

  beforeEach(() => {
    previousCurrentScript = Object.getOwnPropertyDescriptor(document, "currentScript");
    document.body.innerHTML = "<main>Main</main>";
    localStorage.clear();
    delete window.PRDAnnotator;
    delete window.PRDAnnotatorReady;
    delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  });

  afterEach(() => {
    document.querySelector("[data-prd-annotator-ui='host']")?.remove();
    if (previousCurrentScript) {
      Object.defineProperty(document, "currentScript", previousCurrentScript);
    } else {
      delete document.currentScript;
    }
  });

  it("warns and preserves cached annotations when a loaded script does not hydrate", async () => {
    const pageValue = page();
    localStorage.setItem(makeStorageKey(projectId, pageId), JSON.stringify({
      schemaVersion: 2,
      document: {
        ...createEmptyDocument({ projectId, page: pageValue }),
        annotations: [cachedAnnotation()]
      },
      pagePrdMarkdown: ""
    }));
    const sdkScript = document.createElement("script");
    sdkScript.src = "https://example.test/prd-annotator.js";
    sdkScript.dataset.projectId = projectId;
    sdkScript.dataset.pageId = pageId;
    sdkScript.dataset.viewSrc = "nested/no-hydrate.js";
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: sdkScript
    });

    const api = boot(window);
    const loader = document.head.querySelector("[data-prd-annotator-view-loader]");
    loader.dispatchEvent(new Event("load"));
    await Promise.resolve();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(shadow.querySelector("[data-role='view-warning']").textContent)
      .toContain("需要 AI Agent 重新生成本页展示数据");
    expect(api.getSnapshot().document.annotations.map((item) => item.id)).toEqual(["A001"]);
  });

  it("does not warn when a loaded script hydrates an empty document inventory", async () => {
    const sdkScript = document.createElement("script");
    sdkScript.src = "https://example.test/prd-annotator.js";
    sdkScript.dataset.projectId = projectId;
    sdkScript.dataset.pageId = pageId;
    sdkScript.dataset.viewSrc = "nested/empty-view.js";
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: sdkScript
    });

    const api = boot(window);
    api.hydrateView({
      schemaVersion: 2,
      generatedAt: "2026-08-09T00:00:00.000Z",
      projectId,
      page: page(),
      persistedAnnotationFingerprint: "fnv1a32:741638a5",
      document: createEmptyDocument({ projectId, page: page() }),
      documents: []
    });
    document.head.querySelector("[data-prd-annotator-view-loader]")
      .dispatchEvent(new Event("load"));
    await Promise.resolve();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(shadow.querySelector("[data-role='view-warning']").textContent).toBe("");
  });

  it("boots a deep Hash route only after loading its offline registry", async () => {
    history.replaceState({}, "", "/code/index.html#/message/edit/7");
    const sdkScript = document.createElement("script");
    sdkScript.src = "https://example.test/prd-annotator.js";
    sdkScript.dataset.projectId = "project-a";
    sdkScript.dataset.pageId = "index-base";
    sdkScript.dataset.viewSrc = "index-view.js";
    sdkScript.dataset.routeSrc = "routes/index.js";
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: sdkScript
    });

    const ready = boot(window);
    expect(ready).toBeInstanceOf(Promise);
    expect(window.PRDAnnotator).toBeUndefined();

    window.__PRD_ANNOTATOR_ROUTE_REGISTRY__ = {
      schemaVersion: 2,
      projectId: "project-a",
      htmlPath: "code/index.html",
      basePage: {
        id: "index-base",
        title: "Index",
        htmlPath: "code/index.html",
        viewSrc: "index-view.js"
      },
      routes: [{
        id: "message-edit",
        title: "Message Edit",
        routePattern: "/message/edit/:id",
        viewSrc: "message-edit-view.js"
      }]
    };
    document.head.querySelector("[data-prd-annotator-route-loader]")
      .dispatchEvent(new Event("load"));
    await Promise.resolve();
    await Promise.resolve();

    const pageValue = {
      id: "message-edit",
      title: "Message Edit",
      htmlPath: "code/index.html",
      route: "/message/edit/:id"
    };
    window.PRDAnnotator.registerView({
      schemaVersion: 2,
      generatedAt: "2026-08-11T00:00:00.000Z",
      projectId: "project-a",
      page: pageValue,
      persistedAnnotationFingerprint: "fnv1a32:741638a5",
      document: createEmptyDocument({ projectId: "project-a", page: pageValue }),
      documents: []
    });
    document.head.querySelector("[data-prd-annotator-view-loader]")
      .dispatchEvent(new Event("load"));

    const api = await ready;
    expect(api).toBe(window.PRDAnnotator);
    expect(api.getPageId()).toBe("message-edit");
    expect(api.getSnapshot().document.page.route).toBe("/message/edit/:id");
    expect(window.PRDAnnotatorReady).toBe(ready);
  });
});
