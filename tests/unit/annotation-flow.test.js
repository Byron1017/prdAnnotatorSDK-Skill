import { beforeEach, describe, expect, it } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

describe("human annotation flow", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main><section id='device-list'>设备列表</section></main>";
    localStorage.clear();
  });

  it("saves a natural-language comment and displays it immediately", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    shadow.querySelector("[data-action='toggle-annotation']").click();
    document.querySelector("#device-list").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    const textarea = shadow.querySelector("[data-field='comment']");
    textarea.value = "这里需要增加批量停用入口";
    shadow.querySelector("[data-action='save-annotation']").click();
    shadow.querySelector("[data-action='toggle-drawer']").click();

    expect(api.getSnapshot().document.annotations).toHaveLength(1);
    expect(api.getSnapshot().document.annotations[0].id).toBe("A001");
    expect(shadow.querySelector("[data-role='annotation-list']").textContent)
      .toContain("这里需要增加批量停用入口");
    expect(localStorage.length).toBe(1);
  });

  it("does not save an empty or whitespace-only comment", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    shadow.querySelector("[data-action='toggle-annotation']").click();
    document.querySelector("#device-list").dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    shadow.querySelector("[data-field='comment']").value = "   ";
    shadow.querySelector("[data-action='save-annotation']").click();

    expect(api.getSnapshot().document.annotations).toHaveLength(0);
  });
});
