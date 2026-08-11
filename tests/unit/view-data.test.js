import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";
import {
  assertValidViewBundle,
  loadViewScript
} from "../../prd-annotator/src/view-data.js";

function createViewBundle() {
  const page = {
    id: "equipment-ops-7c31fa",
    title: "Equipment Operations",
    htmlPath: "prototype/index.html",
    route: "/prototype/index.html"
  };
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-09T00:00:00.000Z",
    projectId: "device-demo-a13f92",
    page,
    persistedAnnotationFingerprint: "fnv1a32:741638a5",
    document: createEmptyDocument({ projectId: "device-demo-a13f92", page }),
    documents: [{
      id: "doc-page-a",
      title: "Page PRD A",
      path: "doc/page-a.md",
      format: "markdown",
      kind: "page-prd",
      pageIds: [page.id],
      fingerprint: `sha256:${"a".repeat(64)}`,
      previewStatus: "available",
      missing: false,
      content: "# Page A"
    }]
  };
}

describe("view bundle data", () => {
  it("accepts a complete bundle for the expected project and page", () => {
    const bundle = createViewBundle();

    expect(assertValidViewBundle(bundle, {
      projectId: bundle.projectId,
      pageId: bundle.page.id
    })).toEqual(bundle);
  });

  it("rejects an invalid identity, duplicate id, absolute path, and preview state", () => {
    const bundle = createViewBundle();

    expect(() => assertValidViewBundle({ ...bundle, projectId: "another-project" }, {
      projectId: bundle.projectId,
      pageId: bundle.page.id
    })).toThrow("projectId");
    expect(() => assertValidViewBundle({
      ...bundle,
      documents: [...bundle.documents, { ...bundle.documents[0] }]
    })).toThrow("Duplicate document.id");
    expect(() => assertValidViewBundle({
      ...bundle,
      documents: [{ ...bundle.documents[0], path: "/outside.md" }]
    })).toThrow("relative");
    expect(() => assertValidViewBundle({
      ...bundle,
      documents: [{ ...bundle.documents[0], path: "https://example.test/outside.md" }]
    })).toThrow("relative");
    expect(() => assertValidViewBundle({
      ...bundle,
      documents: [{ ...bundle.documents[0], path: "file:///C:/outside.md" }]
    })).toThrow("relative");
    for (const path of [
      " https://example.test/outside.md",
      " //example.test/outside.md",
      " /outside.md",
      " C:\\outside.md",
      " \\server\\outside.md"
    ]) {
      expect(() => assertValidViewBundle({
        ...bundle,
        documents: [{ ...bundle.documents[0], path }]
      })).toThrow("relative");
    }
    expect(() => assertValidViewBundle({
      ...bundle,
      documents: [{ ...bundle.documents[0], previewStatus: "current" }]
    })).toThrow("previewStatus");
    for (const displayGroups of [[], ["unknown"], ["related", "related"], "related"]) {
      expect(() => assertValidViewBundle({
        ...bundle,
        documents: [{ ...bundle.documents[0], displayGroups }]
      })).toThrow("displayGroups");
    }
  });

  it("loads a local view script without using fetch and removes its loader node", async () => {
    const viewDocument = document.implementation.createHTMLDocument("view test");
    const promise = loadViewScript({ document: viewDocument, src: "nested/view/page.js" });
    const script = viewDocument.head.querySelector("script[data-prd-annotator-view-loader='true']");

    expect(script.getAttribute("src")).toBe("nested/view/page.js");
    script.dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
    expect(viewDocument.head.querySelector("[data-prd-annotator-view-loader]")).toBeNull();
  });

  it("supports a distinct safe loader marker for a route registry", async () => {
    const viewDocument = document.implementation.createHTMLDocument("route test");
    const promise = loadViewScript({
      document: viewDocument,
      src: "nested/routes/index.js",
      loaderDataset: "prdAnnotatorRouteLoader"
    });
    const script = viewDocument.head.querySelector("[data-prd-annotator-route-loader='true']");

    expect(script.getAttribute("src")).toBe("nested/routes/index.js");
    script.dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
    expect(viewDocument.head.querySelector("[data-prd-annotator-route-loader]")).toBeNull();
  });

  it("reports a useful error when a local view script cannot load", async () => {
    const viewDocument = document.implementation.createHTMLDocument("view test");
    const promise = loadViewScript({ document: viewDocument, src: "../view/missing.js" });
    const rejection = expect(promise).rejects
      .toThrow("Unable to load PRD Annotator view: ../view/missing.js");
    viewDocument.head.querySelector("[data-prd-annotator-view-loader]")
      .dispatchEvent(new Event("error"));

    await rejection;
  });

  it("rejects remote and absolute view sources before creating a script node", async () => {
    const invalidSources = [
      "https://example.test/view.js",
      "file:///C:/view.js",
      "//example.test/view.js",
      "/absolute/view.js",
      "C:\\absolute\\view.js",
      " https://example.test/view.js",
      " //example.test/view.js",
      " /absolute/view.js",
      " C:\\absolute\\view.js",
      " \\server\\view.js"
    ];
    for (const src of invalidSources) {
      const viewDocument = document.implementation.createHTMLDocument("view test");

      await expect(loadViewScript({ document: viewDocument, src }))
        .rejects.toThrow("relative");
      expect(viewDocument.head.querySelector("[data-prd-annotator-view-loader]")).toBeNull();
    }
  });
});
