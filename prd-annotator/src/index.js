import { createAnnotator } from "./runtime/controller.js";

export function boot(windowObject = window) {
  if (windowObject.PRDAnnotator) return windowObject.PRDAnnotator;

  const script = windowObject.document.currentScript;
  const api = createAnnotator({
    window: windowObject,
    document: windowObject.document,
    scriptSrc: script?.src || "",
    explicitPageId: script?.dataset.pageId,
    explicitProjectId: script?.dataset.projectId
  });

  windowObject.PRDAnnotator = api;
  api.mount();
  return api;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  boot(window);
}
