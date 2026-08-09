import { createAnnotator } from "./runtime/controller.js";
import { loadViewScript } from "./view-data.js";

export function boot(windowObject = window) {
  if (windowObject.PRDAnnotator) return windowObject.PRDAnnotator;

  const script = windowObject.document.currentScript;
  let viewHydrated = false;
  const api = createAnnotator({
    window: windowObject,
    document: windowObject.document,
    scriptSrc: script?.src || "",
    explicitPageId: script?.dataset.pageId,
    explicitProjectId: script?.dataset.projectId,
    onViewHydrated: () => {
      viewHydrated = true;
    }
  });

  windowObject.PRDAnnotator = api;
  api.mount();
  const viewSrc = script?.dataset.viewSrc;
  if (viewSrc) {
    loadViewScript({ document: windowObject.document, src: viewSrc })
      .then(() => {
        if (!viewHydrated) {
          api.reportViewLoadError(new Error("PRD Annotator view script did not hydrate this page"));
        }
      })
      .catch((error) => api.reportViewLoadError(error));
  } else {
    api.reportViewLoadError(new Error("PRD Annotator view source is missing"));
  }
  return api;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  boot(window);
}
