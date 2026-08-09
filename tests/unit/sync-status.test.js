import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprintValue } from "../../prd-annotator/src/fingerprint.js";
import { createEmptyDocument } from "../../prd-annotator/src/model.js";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { computeSyncState } from "../../prd-annotator/src/sync-prompt.js";

const projectId = "device-demo-a13f92";
const pageId = "equipment-ops-7c31fa";

function createApi() {
  return createAnnotator({
    window,
    document,
    scriptSrc: "https://example.test/code/prd-annotator.js",
    explicitProjectId: projectId,
    explicitPageId: pageId
  });
}

function viewBundle(api) {
  const documentValue = api.getSnapshot().document;
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-09T00:00:00.000Z",
    projectId,
    page: documentValue.page,
    persistedAnnotationFingerprint: fingerprintValue(documentValue.annotations),
    document: documentValue,
    documents: []
  };
}

describe("sync state", () => {
  let originalClipboard;

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    document.body.innerHTML = "<main>Equipment operations</main>";
    localStorage.clear();
  });

  afterEach(() => {
    document.querySelector("[data-prd-annotator-ui='host']")?.remove();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else delete navigator.clipboard;
    vi.restoreAllMocks();
  });

  it.each([
    [{ currentFingerprint: "a", persistedFingerprint: "a", cacheStatus: { mode: "storage" } }, "synced"],
    [{ currentFingerprint: "a", persistedFingerprint: "b", cacheStatus: { mode: "storage" } }, "browser-only"],
    [{ currentFingerprint: "a", persistedFingerprint: "a", cacheStatus: { mode: "memory" } }, "memory-only"]
  ])("classifies %o as %s", (input, expected) => {
    expect(computeSyncState(input)).toBe(expected);
  });

  it("exposes the annotation-only fingerprint and reflects a persisted view", () => {
    const api = createApi();
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(api.getSnapshot().annotationFingerprint)
      .toBe(fingerprintValue(api.getSnapshot().document.annotations));
    expect(shadow.querySelector("[data-role='sync-state']").dataset.state).toBe("browser-only");

    api.hydrateView(viewBundle(api));

    expect(shadow.querySelector("[data-role='sync-state']").dataset.state).toBe("synced");
    expect(shadow.querySelector("[data-role='sync-state']").textContent).toContain("已同步到项目");
  });

  it("does not report copied data as synchronized", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    const api = createApi();
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    shadow.querySelector("[data-action='copy-sync-prompt']").click();
    await Promise.resolve();

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    expect(clipboard.writeText).toHaveBeenCalledWith(api.getSyncPrompt());
    expect(shadow.querySelector("[data-role='sync-state']").dataset.state)
      .toBe("browser-only");
    expect(shadow.querySelector("[data-role='copy-result']").textContent)
      .toContain("请返回 AI Agent 粘贴并发送");
    expect(shadow.querySelector("[data-role='sync-help']").textContent)
      .toContain("复制返回 AI Agent粘贴并发送等待文件写入报告");
  });

  it("keeps a selectable prompt available when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
    });
    const api = createApi();
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    shadow.querySelector("[data-action='copy-sync-prompt']").click();
    await Promise.resolve();
    await Promise.resolve();

    const fallback = shadow.querySelector("[data-role='sync-prompt-fallback']");
    expect(fallback).not.toBeNull();
    expect(fallback.readOnly).toBe(true);
    expect(fallback.value).toBe(api.getSyncPrompt());
  });

  it("warns that synchronization is required when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const api = createApi();
    api.mount();
    api.hydrate({ document: createEmptyDocument(api.getSnapshot().document) });
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    expect(shadow.querySelector("[data-role='sync-state']").dataset.state).toBe("memory-only");
    expect(shadow.querySelector("[data-role='sync-state']").textContent)
      .toContain("关闭页面前必须复制提示词并让 AI 同步");
  });
});
