import { beforeEach, describe, expect, it } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { resolvePageIdFromSeed } from "../../prd-annotator/src/identity.js";
import { makeStorageKey } from "../../prd-annotator/src/storage.js";

const basePage = Object.freeze({
  id: "index-base",
  title: "Index",
  htmlPath: "index.html",
  viewSrc: "index.js"
});

const routes = Object.freeze([
  {
    id: "message-list",
    title: "Message List",
    routePattern: "/message/list",
    viewSrc: "list.js"
  },
  {
    id: "message-edit",
    title: "Message Edit",
    routePattern: "/message/edit/:id",
    viewSrc: "edit.js"
  }
]);

function annotation(id) {
  return {
    id,
    title: id,
    description: `${id} description`,
    type: "requirement",
    prdContent: `${id} PRD`,
    acceptanceCriteria: "",
    dataFields: "",
    apiPath: "",
    edgeCases: "",
    status: "open",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Main",
      rect: { x: 0, y: 0, width: 10, height: 10 }
    },
    prd: {
      linkedDocuments: [],
      linkedSections: [],
      impactScope: "page",
      summary: ""
    }
  };
}

function createRouteAnnotator() {
  return createAnnotator({
    window,
    document,
    explicitProjectId: "project-a",
    explicitPageId: basePage.id,
    basePage,
    routes
  });
}

function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function cacheRecord({ pageId, route, annotations }) {
  return {
    schemaVersion: 2,
    document: {
      schemaVersion: 2,
      projectId: "project-a",
      page: { id: pageId, title: pageId, htmlPath: "index.html", route },
      annotations,
      managedPrd: null
    },
    pagePrdMarkdown: "",
    viewDocuments: [],
    persistedAnnotationFingerprint: "",
    viewGeneratedAt: ""
  };
}

describe("logical Hash page switching", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main>Main</main>";
    history.replaceState({}, "", "/index.html#/message/edit/7");
    localStorage.clear();
  });

  it("uses the matching logical page on initial deep-link load", () => {
    const api = createRouteAnnotator();

    expect(api.getPageId()).toBe("message-edit");
    expect(api.getSnapshot().document.page).toMatchObject({
      id: "message-edit",
      title: "Message Edit",
      htmlPath: "index.html",
      route: "/message/edit/:id"
    });
  });

  it("keeps annotations isolated while switching routes in one HTML", () => {
    const api = createRouteAnnotator();
    api.mount();
    const editDocument = api.getSnapshot().document;
    api.hydrate({
      document: { ...editDocument, annotations: [annotation("A001")] }
    });

    navigate("#/message/list");

    expect(api.getPageId()).toBe("message-list");
    expect(api.getSnapshot().document.annotations).toEqual([]);

    navigate("#/message/edit/9");

    expect(api.getPageId()).toBe("message-edit");
    expect(api.getSnapshot().document.annotations.map((item) => item.id))
      .toEqual(["A001"]);
    api.unmount();
  });

  it("resets the Drawer to 本页标注 when the logical page changes", () => {
    const api = createRouteAnnotator();
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
    shadow.querySelector("[data-tab='api-doc']").click();
    expect(shadow.querySelector("[data-tab='api-doc']").getAttribute("aria-selected")).toBe("true");

    navigate("#/message/list");

    expect(shadow.querySelector("[data-tab='annotations']").getAttribute("aria-selected")).toBe("true");
    expect([...shadow.querySelectorAll("[role='tabpanel']")]
      .filter((panel) => !panel.hidden)
      .map((panel) => panel.dataset.panel)).toEqual(["annotations"]);
    api.unmount();
  });

  it("does not switch logical pages when only query or dynamic values change", () => {
    const api = createRouteAnnotator();
    api.mount();
    const firstId = api.getPageId();

    navigate("#/message/edit/8?tab=fields");

    expect(api.getPageId()).toBe(firstId);
    expect(api.getSnapshot().locationIdentity.route).toBe("/message/edit/8");
    api.unmount();
  });

  it("uses the document page for a normal anchor", () => {
    const api = createRouteAnnotator();
    api.mount();

    navigate("#section-title");

    expect(api.getPageId()).toBe(basePage.id);
    expect(api.getSnapshot().document.page.route).toBe("/index.html");
    api.unmount();
  });

  it("quarantines an unregistered route instead of loading another page", () => {
    const api = createRouteAnnotator();
    api.mount();

    navigate("#/unregistered/7?tab=base");

    expect(api.getPageId()).toBe(resolvePageIdFromSeed({
      slug: "unknown",
      seed: "/index.html#/unregistered/7"
    }));
    expect(api.getSnapshot().document.annotations).toEqual([]);
    expect(api.getSnapshot().locationIdentity.registered).toBe(false);
    api.unmount();
  });

  it("does not treat old document-page annotations as route annotations", () => {
    const oldRecord = cacheRecord({
      pageId: basePage.id,
      route: "/index.html",
      annotations: [annotation("A007")]
    });
    const oldKey = makeStorageKey("project-a", basePage.id);
    localStorage.setItem(oldKey, JSON.stringify(oldRecord));

    const api = createRouteAnnotator();

    expect(api.getPageId()).toBe("message-edit");
    expect(api.getSnapshot().document.annotations).toEqual([]);
    expect(JSON.parse(localStorage.getItem(oldKey)).document.annotations[0].id)
      .toBe("A007");
  });

  it("recovers a quarantined route cache after that route is registered", () => {
    const fallbackId = resolvePageIdFromSeed({
      slug: "unknown",
      seed: "/index.html#/message/edit/7"
    });
    const fallbackKey = makeStorageKey("project-a", fallbackId);
    localStorage.setItem(fallbackKey, JSON.stringify(cacheRecord({
      pageId: fallbackId,
      route: "/message/edit/7",
      annotations: [annotation("A009")]
    })));

    const api = createRouteAnnotator();

    expect(api.getPageId()).toBe("message-edit");
    expect(api.getSnapshot().document.annotations.map((item) => item.id))
      .toEqual(["A009"]);
    expect(localStorage.getItem(fallbackKey)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(makeStorageKey("project-a", "message-edit")))
      .document.annotations.map((item) => item.id)).toEqual(["A009"]);
  });
});
