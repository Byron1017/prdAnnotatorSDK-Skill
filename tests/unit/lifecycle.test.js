import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("SDK lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "<main><button id='business'>Business button</button></main>";
    localStorage.clear();
    delete window.PRDAnnotator;
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
    localStorage.setItem("prd-annotator:sentinel", "retain-sentinel-bytes");
    localStorage.setItem("prd-annotator:cached-document", JSON.stringify({ annotations: ["A001"] }));
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    const clearSpy = vi.spyOn(Storage.prototype, "clear");
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
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("exposes the exact non-destructive runtime keys from both source and built SDK objects", () => {
    const expectedKeys = [
      "version",
      "mount",
      "unmount",
      "isMounted",
      "getPageId",
      "getSnapshot",
      "getSyncPrompt",
      "hydrate",
      "hydrateView",
      "reportViewLoadError"
    ];
    const sourceApi = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    const builtSource = readFileSync(path.join(repositoryRoot, "prd-annotator/prd-annotator.js"), "utf8");
    const controllerSource = readFileSync(path.join(repositoryRoot, "prd-annotator/src/runtime/controller.js"), "utf8");

    window.eval(builtSource);
    const builtApi = window.PRDAnnotator;

    for (const api of [sourceApi, builtApi]) {
      expect(Object.keys(api)).toEqual(expectedKeys);
      expect(Object.keys(api).filter((key) => /delete|clear|purge|reset/i.test(key))).toEqual([]);
    }
    expect(`${controllerSource}\n${builtSource}`).not.toMatch(/\b(?:removeItem|clearAll|resetData|purge)\b/);

    sourceApi.unmount();
    builtApi.unmount();
  });
});
