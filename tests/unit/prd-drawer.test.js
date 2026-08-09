import { beforeEach, describe, expect, it } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";
import { makeStorageKey } from "../../prd-annotator/src/storage.js";

const annotation = (id) => ({
  id,
  comment: `comment-${id}`,
  status: "applied",
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
  target: {
    cssPath: "main",
    xpath: "/html/body/main",
    textQuote: "Main",
    rect: { x: 0, y: 0, width: 10, height: 10 }
  },
  prd: {
    linkedSections: ["3.2 批量操作"],
    impactScope: "page",
    summary: "增加批量停用"
  }
});

const viewBundle = {
  schemaVersion: 2,
  generatedAt: "2026-08-09T00:00:00.000Z",
  projectId: "device-demo-a13f92",
  page: {
    id: "equipment-ops-7c31fa",
    title: "Equipment Operations",
    htmlPath: "prototype/index.html"
  },
  persistedAnnotationFingerprint: "fnv1a32:741638a5",
  document: createEmptyDocument({
    projectId: "device-demo-a13f92",
    page: {
      id: "equipment-ops-7c31fa",
      title: "Equipment Operations",
      htmlPath: "prototype/index.html",
      route: "/prototype/index.html"
    }
  }),
  documents: [
    { id: "doc-page-a", title: "Page PRD A", path: "doc/page-a.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: `sha256:${"a".repeat(64)}`, previewStatus: "available", missing: false, content: "# Page A" },
    { id: "doc-page-b", title: "Page PRD B", path: "requirements/page-b.md", format: "markdown", kind: "page-prd", pageIds: ["equipment-ops-7c31fa"], fingerprint: `sha256:${"b".repeat(64)}`, previewStatus: "available", missing: false, content: "# Page B" },
    { id: "doc-total", title: "Total PRD", path: "PRD.md", format: "markdown", kind: "total-prd", pageIds: [], fingerprint: `sha256:${"c".repeat(64)}`, previewStatus: "available", missing: false, content: "# Product" },
    { id: "doc-other", title: "Open Questions", path: "notes/questions.txt", format: "text", kind: "unclassified", pageIds: [], fingerprint: `sha256:${"d".repeat(64)}`, previewStatus: "available", missing: false, content: "Question one" },
    { id: "doc-pdf", title: "Legacy PDF", path: "legacy/requirements.pdf", format: "pdf", kind: "requirement", pageIds: [], fingerprint: `sha256:${"e".repeat(64)}`, previewStatus: "unavailable", missing: false, content: "" }
  ]
};

describe("PRD hydration", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main>Main</main>";
    localStorage.clear();
    delete window.hacked;
  });

  it("merges permanent data without dropping a browser-only annotation", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const page = api.getSnapshot().document.page;

    api.hydrate({
      document: {
        ...createEmptyDocument(page),
        annotations: [annotation("A001")]
      },
      pagePrdMarkdown: "# 页面 PRD"
    });
    api.hydrate({
      document: {
        ...createEmptyDocument(page),
        annotations: [annotation("A002")]
      },
      pagePrdMarkdown: "# 更新后的页面 PRD"
    });

    expect(api.getSnapshot().document.annotations.map((item) => item.id))
      .toEqual(["A001", "A002"]);
    expect(api.getSnapshot().pagePrdMarkdown).toBe("# 更新后的页面 PRD");
  });

  it("renders Markdown as DOM text without executing embedded HTML", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const page = api.getSnapshot().document.page;

    api.hydrate({
      document: createEmptyDocument(page),
      pagePrdMarkdown: "# 页面 PRD\n\n- 条目一\n\n<script>window.hacked=true</script>"
    });
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
    shadow.querySelector("[data-action='toggle-drawer']").click();

    expect(shadow.querySelector("[data-role='prd-content'] h1").textContent)
      .toBe("页面 PRD");
    expect(shadow.querySelector("[data-role='prd-content']").textContent)
      .toContain("<script>");
    expect(window.hacked).toBeUndefined();
  });

  it("renders every ambiguous PRD with its source path", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js",
      explicitProjectId: viewBundle.projectId,
      explicitPageId: viewBundle.page.id
    });
    api.mount();
    api.hydrateView(viewBundle);
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;
    const text = shadow.querySelector("[data-role='document-groups']").textContent;

    expect(text).toContain("Page PRD A");
    expect(text).toContain("doc/page-a.md");
    expect(text).toContain("Page PRD B");
    expect(text).toContain("requirements/page-b.md");
    expect(shadow.querySelector("[data-document-id='doc-page-a']").textContent)
      .toContain("格式：markdown");
  });

  it("shows an unavailable preview instead of omitting a PDF", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js",
      explicitProjectId: viewBundle.projectId,
      explicitPageId: viewBundle.page.id
    });
    api.mount();
    api.hydrateView(viewBundle);
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(shadow.querySelector("[data-document-id='doc-pdf']").textContent)
      .toContain("暂不可预览");
  });

  it("shows stale and missing-view warnings without dropping annotations", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js",
      explicitProjectId: viewBundle.projectId,
      explicitPageId: viewBundle.page.id
    });
    api.mount();
    api.hydrateView({
      ...viewBundle,
      documents: viewBundle.documents.map((item) => item.id === "doc-page-a"
        ? { ...item, previewStatus: "stale" }
        : item)
    });
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(shadow.querySelector("[data-document-id='doc-page-a']").textContent)
      .toContain("内容可能已过期");
    api.reportViewLoadError(new Error("view script missing"));
    expect(shadow.querySelector("[data-role='view-warning']").textContent)
      .toContain("需要 AI Agent 重新生成本页展示数据");
    expect(api.getSnapshot().document.annotations)
      .toEqual(viewBundle.document.annotations);
  });

  it("keeps cached annotations available when cached view inventory is malformed", () => {
    const cachedDocument = {
      ...viewBundle.document,
      annotations: [annotation("A003")]
    };
    localStorage.setItem(makeStorageKey(viewBundle.projectId, viewBundle.page.id), JSON.stringify({
      schemaVersion: 2,
      document: cachedDocument,
      pagePrdMarkdown: "",
      viewDocuments: [{}],
      persistedAnnotationFingerprint: viewBundle.persistedAnnotationFingerprint,
      viewGeneratedAt: viewBundle.generatedAt
    }));
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js",
      explicitProjectId: viewBundle.projectId,
      explicitPageId: viewBundle.page.id
    });

    expect(() => api.mount()).not.toThrow();
    expect(api.getSnapshot().document.annotations.map((item) => item.id)).toEqual(["A003"]);
  });
});
