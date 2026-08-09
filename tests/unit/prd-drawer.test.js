import { beforeEach, describe, expect, it } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";

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
});
