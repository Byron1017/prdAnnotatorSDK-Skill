import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

describe("SDK lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main><button id='business'>Business button</button></main>";
    localStorage.clear();
  });

  it("mounts one isolated host with exactly two permanent tool buttons", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });

    api.mount();

    const host = document.querySelector("[data-prd-annotator-ui='host']");
    expect(host.shadowRoot).toBeTruthy();
    expect([
      ...host.shadowRoot.querySelectorAll("[data-role='tool-button']")
    ].map((node) => node.textContent.trim())).toEqual(["标注模式", "PRD 标注"]);
    expect(document.querySelector("#business").textContent).toBe("Business button");
  });

  it("is idempotent across repeated mount and unmount calls", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });

    api.mount();
    api.mount();
    expect(document.querySelectorAll("[data-prd-annotator-ui='host']"))
      .toHaveLength(1);

    api.unmount();
    api.unmount();
    expect(document.querySelector("[data-prd-annotator-ui='host']")).toBeNull();
  });

  it("unmounts visual state without removing cached data", () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });

    api.mount();
    const before = api.getSnapshot();
    api.unmount();

    expect(api.getSnapshot()).toEqual(before);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
