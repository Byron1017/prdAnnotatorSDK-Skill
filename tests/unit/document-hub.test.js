import { beforeEach, describe, expect, it } from "vitest";
import { createDocumentHub } from "../../prd-annotator/src/ui/document-hub.js";

function documentEntry(overrides = {}) {
  return {
    id: "doc-example",
    title: "Example",
    path: "docs/example.md",
    format: "markdown",
    kind: "requirement",
    scope: "global",
    pageIds: [],
    fingerprint: `sha256:${"a".repeat(64)}`,
    previewStatus: "available",
    missing: false,
    content: "# Example",
    ...overrides
  };
}

function hubRoot() {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-hub-view="entries"></div>
    <div data-hub-view="detail" hidden>
      <button type="button" data-action="back-to-document-hub">返回文档入口</button>
      <h3 data-role="hub-detail-title"></h3>
      <div data-role="hub-global-documents"></div>
      <div data-role="hub-candidate-documents"></div>
    </div>
  `;
  return root;
}

describe("global document hub", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders four ordered entry cards with global and candidate counts", () => {
    const root = hubRoot();
    const hub = createDocumentHub({ root });
    hub.render([
      documentEntry({ id: "global-fields", title: "Global Fields", kind: "field-spec" }),
      documentEntry({ id: "candidate-fields", title: "Candidate Fields", kind: "field-spec", scope: "unassigned" }),
      documentEntry({ id: "page-fields", title: "Page Fields", kind: "field-spec", scope: "page", pageIds: ["page-a"] })
    ]);

    expect([...root.querySelectorAll("[data-hub-category]")].map((node) => node.dataset.hubCategory))
      .toEqual(["requirement", "prd", "field", "api"]);
    const field = root.querySelector("[data-hub-category='field']");
    expect(field.textContent).toContain("总字段规范");
    expect(field.textContent).toContain("全局文档 1");
    expect(field.textContent).toContain("待关联候选 1");
  });

  it("opens a category, separates scopes, excludes page documents, and returns", () => {
    const root = hubRoot();
    const hub = createDocumentHub({ root });
    hub.render([
      documentEntry({ id: "global-fields", title: "Global Fields", kind: "field-spec" }),
      documentEntry({ id: "candidate-fields", title: "Candidate Fields", kind: "field-spec", scope: "unassigned" }),
      documentEntry({ id: "page-fields", title: "Page Fields", kind: "field-spec", scope: "page", pageIds: ["page-a"] })
    ]);

    root.querySelector("[data-hub-category='field']").click();
    expect(root.querySelector("[data-hub-view='detail']").hidden).toBe(false);
    expect(root.querySelector("[data-role='hub-global-documents']").textContent).toContain("Global Fields");
    expect(root.querySelector("[data-role='hub-candidate-documents']").textContent).toContain("Candidate Fields");
    expect(root.textContent).not.toContain("Page Fields");

    root.querySelector("[data-action='back-to-document-hub']").click();
    expect(root.querySelector("[data-hub-view='entries']").hidden).toBe(false);
  });

  it.each([
    ["requirement", "requirement", "总需求文档"],
    ["prd", "total-prd", "总 PRD 文档"],
    ["field", "field-spec", "总字段规范"],
    ["api", "api-doc", "总接口文档"]
  ])("maps the %s category and renders empty candidate state", (category, kind, label) => {
    const root = hubRoot();
    const hub = createDocumentHub({ root });
    hub.render([documentEntry({ id: `global-${category}`, title: label, kind })]);
    hub.open(category);

    expect(root.querySelector("[data-role='hub-detail-title']").textContent).toBe(label);
    expect(root.querySelector("[data-role='hub-global-documents']").textContent).toContain(label);
    expect(root.querySelector("[data-role='hub-candidate-documents']").textContent).toContain("暂无待关联候选");
  });
});
