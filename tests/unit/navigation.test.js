import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAnnotator } from "../../prd-annotator/src/runtime/controller.js";
import { observeNavigation } from "../../prd-annotator/src/runtime/navigation.js";
import { createOverlayController } from "../../prd-annotator/src/ui/overlay.js";

describe("navigation and cleanup", () => {
  beforeEach(() => {
    document.body.innerHTML = "<main>Main</main>";
    history.replaceState({}, "", "/page-one");
    localStorage.clear();
  });

  it("observes pushState and restores the original history method", () => {
    const original = history.pushState;
    const listener = vi.fn();
    const stop = observeNavigation(window, listener);

    history.pushState({}, "", "/page-two");
    expect(listener).toHaveBeenCalledWith({ pathname: "/page-two", hash: "" });
    stop();
    expect(history.pushState).toBe(original);
  });

  it("observes Hash changes with the complete location snapshot", () => {
    const listener = vi.fn();
    const stop = observeNavigation(window, listener);

    window.location.hash = "#/message/manage";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(listener).toHaveBeenLastCalledWith({
      pathname: "/page-one",
      hash: "#/message/manage"
    });
    stop();
  });

  it("switches to a different page id and cache after SPA navigation", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const firstId = api.getPageId();

    history.pushState({}, "", "/page-two");

    expect(api.getPageId()).not.toBe(firstId);
    expect(api.getSnapshot().document.page.route).toBe("/page-two");
    api.unmount();
  });

  it("Escape exits annotation mode before closing the Drawer", () => {
    const api = createAnnotator({
      window,
      document,
      scriptSrc: "https://example.test/code/prd-annotator.js"
    });
    api.mount();
    const shadow = document.querySelector("[data-prd-annotator-ui='host']").shadowRoot;

    shadow.querySelector("[data-action='toggle-annotation']").click();
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true
    }));

    expect(shadow.querySelector("[data-action='toggle-annotation']")
      .getAttribute("aria-pressed")).toBe("false");
    api.unmount();
  });

  it("supports marker refresh when animation-frame APIs are unavailable", () => {
    const animationFrameDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "requestAnimationFrame"
    );
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: undefined
    });
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const container = document.createElement("div");
    const overlay = createOverlayController({
      document,
      container
    });

    try {
      window.dispatchEvent(new Event("resize"));
      expect(setTimeoutSpy).toHaveBeenCalledOnce();
    } finally {
      overlay.destroy();
      if (animationFrameDescriptor) {
        Object.defineProperty(
          window,
          "requestAnimationFrame",
          animationFrameDescriptor
        );
      } else {
        delete window.requestAnimationFrame;
      }
    }
  });

  it("keeps the animation-frame function captured at overlay creation", () => {
    const animationFrameDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "requestAnimationFrame"
    );
    const cancelFrameDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "cancelAnimationFrame"
    );
    const requestFrame = vi.fn(() => 1);
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: requestFrame
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn()
    });
    const overlay = createOverlayController({
      document,
      container: document.createElement("div")
    });

    try {
      Object.defineProperty(window, "requestAnimationFrame", {
        configurable: true,
        value: undefined
      });
      window.dispatchEvent(new Event("resize"));
      expect(requestFrame).toHaveBeenCalledOnce();
    } finally {
      overlay.destroy();
      if (animationFrameDescriptor) {
        Object.defineProperty(
          window,
          "requestAnimationFrame",
          animationFrameDescriptor
        );
      } else {
        delete window.requestAnimationFrame;
      }
      if (cancelFrameDescriptor) {
        Object.defineProperty(
          window,
          "cancelAnimationFrame",
          cancelFrameDescriptor
        );
      } else {
        delete window.cancelAnimationFrame;
      }
    }
  });
});
