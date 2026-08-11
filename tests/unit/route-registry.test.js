import { beforeEach, describe, expect, it } from "vitest";
import { fingerprintValue } from "../../prd-annotator/src/fingerprint.js";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import {
  assertValidRouteRegistry,
  loadRouteRegistryScript
} from "../../prd-annotator/src/runtime/route-registry.js";

const projectId = "project-a";
const basePage = Object.freeze({
  id: "index-base",
  title: "Index",
  htmlPath: "code/index.html",
  viewSrc: "index-view.js"
});
const routes = Object.freeze([
  {
    id: "message-list",
    title: "Message List",
    routePattern: "/message/list",
    viewSrc: "list-view.js"
  },
  {
    id: "message-edit",
    title: "Message Edit",
    routePattern: "/message/edit/:id",
    viewSrc: "edit-view.js"
  }
]);
const registry = Object.freeze({
  schemaVersion: 2,
  projectId,
  htmlPath: basePage.htmlPath,
  basePage,
  routes
});

function bundle(pageId) {
  const route = pageId === "message-list"
    ? "/message/list"
    : "/message/edit/:id";
  const page = {
    id: pageId,
    title: pageId,
    htmlPath: basePage.htmlPath,
    route
  };
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-11T00:00:00.000Z",
    projectId,
    page,
    persistedAnnotationFingerprint: fingerprintValue([]),
    document: createEmptyDocument({ projectId, page }),
    documents: []
  };
}

describe("offline route registry", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main>Main</main>";
    history.replaceState({}, "", "/code/index.html#/message/edit/7");
    localStorage.clear();
    delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  });

  it("validates a complete registry for the expected script identity", () => {
    expect(assertValidRouteRegistry(registry, {
      projectId,
      pageId: basePage.id
    })).toBe(registry);
  });

  it("rejects duplicate ids, duplicate patterns, remote sources, and identity drift", () => {
    expect(() => assertValidRouteRegistry(registry, {
      projectId: "another-project",
      pageId: basePage.id
    })).toThrow("projectId");
    expect(() => assertValidRouteRegistry({
      ...registry,
      routes: [...routes, { ...routes[0] }]
    }, { projectId, pageId: basePage.id })).toThrow("Duplicate route page id");
    expect(() => assertValidRouteRegistry({
      ...registry,
      routes: [{ ...routes[0], id: "another", routePattern: routes[1].routePattern }, routes[1]]
    }, { projectId, pageId: basePage.id })).toThrow("Duplicate route pattern");
    expect(() => assertValidRouteRegistry({
      ...registry,
      routes: [{ ...routes[0], viewSrc: "https://example.test/view.js" }]
    }, { projectId, pageId: basePage.id })).toThrow("relative");
  });

  it("loads a relative registry script and removes its loader node", async () => {
    const viewDocument = document.implementation.createHTMLDocument("registry test");
    const promise = loadRouteRegistryScript({
      window,
      document: viewDocument,
      src: "nested/routes/index.js",
      expected: { projectId, pageId: basePage.id }
    });
    const loader = viewDocument.head.querySelector("[data-prd-annotator-route-loader]");
    window.__PRD_ANNOTATOR_ROUTE_REGISTRY__ = registry;

    expect(loader.getAttribute("src")).toBe("nested/routes/index.js");
    loader.dispatchEvent(new Event("load"));

    await expect(promise).resolves.toBe(registry);
    expect(viewDocument.head.querySelector("[data-prd-annotator-route-loader]")).toBeNull();
    expect(window.__PRD_ANNOTATOR_ROUTE_REGISTRY__).toBeUndefined();
  });

  it("registers a late View without hydrating it into a different active route", () => {
    const api = createAnnotator({
      window,
      document,
      explicitProjectId: projectId,
      explicitPageId: basePage.id,
      basePage,
      routes
    });
    api.mount();
    api.registerView(bundle("message-edit"));

    window.location.hash = "#/message/list";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    api.registerView(bundle("message-edit"));

    expect(api.getPageId()).toBe("message-list");
    expect(api.getSnapshot().document.page.id).toBe("message-list");

    api.registerView(bundle("message-list"));
    expect(api.getSnapshot().document.page.id).toBe("message-list");
    api.unmount();
  });
});
