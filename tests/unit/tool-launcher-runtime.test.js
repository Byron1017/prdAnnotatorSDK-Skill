import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { makeToolLauncherPreferenceKey } from "../../prd-annotator/src/ui/tool-launcher-preference.js";

const basePage = Object.freeze({
  id: "index-base",
  title: "Index",
  htmlPath: "index.html",
  viewSrc: "index.js"
});

const routes = Object.freeze([
  {
    id: "message-list",
    title: "Message List",
    routePattern: "/message/list",
    viewSrc: "list.js"
  },
  {
    id: "message-edit",
    title: "Message Edit",
    routePattern: "/message/edit/:id",
    viewSrc: "edit.js"
  }
]);

function currentShell() {
  const host = document.querySelector("[data-prd-annotator-ui='host']");
  return {
    host,
    shadow: host.shadowRoot,
    get actions() {
      return host.shadowRoot.querySelector("[data-role='tool-actions']");
    },
    get toggle() {
      return host.shadowRoot.querySelector(
        "[data-role='tool-launcher-toggle']"
      );
    }
  };
}

function createProjectAnnotator(pageId = "page-one") {
  return createAnnotator({
    window,
    document,
    explicitProjectId: "project-a",
    explicitPageId: pageId
  });
}

function navigate(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

describe("tool launcher runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "<main>Main target</main>";
    history.replaceState({}, "", "/index.html");
    localStorage.clear();
  });

  it("persists one project choice across remounts and physical page instances", () => {
    const first = createProjectAnnotator("page-one");
    first.mount();
    currentShell().toggle.click();

    expect(currentShell().actions.hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem(
      makeToolLauncherPreferenceKey("project-a")
    ))).toEqual({ collapsed: true });

    first.unmount();
    first.mount();
    expect(currentShell().actions.hidden).toBe(true);

    first.unmount();
    const secondPage = createProjectAnnotator("page-two");
    secondPage.mount();
    expect(currentShell().actions.hidden).toBe(true);
    secondPage.unmount();
  });

  it("retains the launcher choice across registered Hash route changes", () => {
    history.replaceState({}, "", "/index.html#/message/edit/7");
    const api = createAnnotator({
      window,
      document,
      explicitProjectId: "project-a",
      explicitPageId: basePage.id,
      basePage,
      routes
    });
    api.mount();
    currentShell().toggle.click();

    navigate("#/message/list");

    expect(api.getPageId()).toBe("message-list");
    expect(currentShell().actions.hidden).toBe(true);
    expect(currentShell().toggle.getAttribute("aria-expanded")).toBe("false");
    api.unmount();
  });

  it("does not close layers, disable annotation mode, or alter sync data", () => {
    const api = createProjectAnnotator();
    api.mount();
    const shell = currentShell();
    const annotationButton = shell.shadow.querySelector(
      "[data-action='toggle-annotation']"
    );
    const drawerButton = shell.shadow.querySelector(
      "[data-action='toggle-drawer']"
    );
    annotationButton.click();
    document.querySelector("main").click();
    drawerButton.click();
    const snapshotBefore = JSON.stringify(api.getSnapshot());
    const promptBefore = api.getSyncPrompt();

    shell.toggle.click();

    expect(shell.actions.hidden).toBe(true);
    expect(annotationButton.getAttribute("aria-pressed")).toBe("true");
    expect(shell.shadow.querySelector("[data-role='editor']").hidden).toBe(false);
    expect(shell.shadow.querySelector("[data-role='drawer']").hidden).toBe(false);
    expect(shell.toggle.dataset.annotationActive).toBe("true");
    expect(shell.toggle.getAttribute("aria-label"))
      .toBe("展开 PRD 标注工具（标注模式已开启）");
    expect(JSON.stringify(api.getSnapshot())).toBe(snapshotBefore);
    expect(api.getSyncPrompt()).toBe(promptBefore);
    api.unmount();
  });

  it("keeps mounting and toggling when localStorage access throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("read blocked");
      });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("write blocked");
      });
    const api = createProjectAnnotator();

    expect(() => api.mount()).not.toThrow();
    expect(() => currentShell().toggle.click()).not.toThrow();
    expect(currentShell().actions.hidden).toBe(true);

    api.unmount();
    api.mount();
    expect(currentShell().actions.hidden).toBe(true);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
    api.unmount();
  });

  it("keeps core workflows available when the localStorage getter throws", () => {
    const storageGetterSpy = vi.spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("origin storage blocked", "SecurityError");
      });
    let api;

    expect(() => {
      api = createProjectAnnotator();
    }).not.toThrow();
    expect(() => api.mount()).not.toThrow();

    const shell = currentShell();
    shell.shadow.querySelector("[data-action='toggle-annotation']").click();
    document.querySelector("main").click();
    shell.shadow.querySelector("[data-field='title']").value = "Memory annotation";
    shell.shadow.querySelector("[data-field='description']").value = "Stored in memory";
    shell.shadow.querySelector("[data-field='prdContent']").value = "Memory PRD";
    shell.shadow.querySelector("[data-action='save-annotation']").click();

    expect(api.getSnapshot().document.annotations).toHaveLength(1);
    shell.shadow.querySelector("[data-action='toggle-drawer']").click();
    expect(shell.shadow.querySelector("[data-role='drawer']").hidden).toBe(false);
    expect(api.getSyncPrompt()).toContain("---PRD_ANNOTATOR_PAYLOAD_START---");

    shell.toggle.click();
    expect(shell.actions.hidden).toBe(true);

    api.unmount();
    storageGetterSpy.mockRestore();
  });
});
