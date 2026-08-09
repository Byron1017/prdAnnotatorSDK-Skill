import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

  it("unmounts only the host and listeners while preserving byte-equal snapshots and browser cache", () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });

    api.mount();
    const snapshotBefore = JSON.stringify(api.getSnapshot());
    const cacheBefore = JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]));
    api.unmount();

    expect(document.querySelector("[data-prd-annotator-ui='host']")).toBeNull();
    expect(JSON.stringify(api.getSnapshot())).toBe(snapshotBefore);
    expect(JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))).toBe(cacheBefore);
    expect(removeListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("exposes no destructive method from the built SDK public API", () => {
    const builtSource = readFileSync(path.join(repositoryRoot, "prd-annotator/prd-annotator.js"), "utf8");
    const apiBlock = /const api = \{([\s\S]*?)\n\s*\};\n\s*return Object\.freeze\(api\);/.exec(builtSource);

    expect(apiBlock).toBeTruthy();
    expect(apiBlock[1]).not.toMatch(/^\s*(?:delete|clear|purge|reset)[a-z0-9_$]*\s*[:,]/im);
  });
});
