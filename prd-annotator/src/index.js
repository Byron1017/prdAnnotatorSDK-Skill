import { createAnnotator } from "./runtime/controller.js";
import { loadRouteRegistryScript } from "./runtime/route-registry.js";
import { loadViewScript } from "./view-data.js";

function fallbackBasePage(windowObject, script) {
  const pathname = windowObject.location?.pathname || "/";
  const id = script?.dataset.pageId || "page";
  return {
    id,
    title: windowObject.document.title || id,
    htmlPath: pathname.replace(/^\/+/, "") || "index.html",
    viewSrc: script?.dataset.viewSrc || ""
  };
}

function createMountedAnnotator({
  windowObject,
  script,
  basePage,
  routes,
  initialError
}) {
  let api;
  let viewRequestToken = 0;
  const hydratedPageIds = new Set();

  async function requestView(identity) {
    const token = ++viewRequestToken;
    if (!identity?.registered || !identity.viewSrc) {
      if (token === viewRequestToken) {
        api.reportViewLoadError(new Error(
          identity?.registered
            ? "PRD Annotator view source is missing"
            : "PRD Annotator route is not registered; ask the AI Agent to refresh the route map"
        ));
      }
      return;
    }

    try {
      await loadViewScript({
        document: windowObject.document,
        src: identity.viewSrc
      });
      if (
        token === viewRequestToken
        && api.getPageId() === identity.pageId
        && !hydratedPageIds.has(identity.pageId)
      ) {
        api.reportViewLoadError(new Error(
          "PRD Annotator view script did not register this page"
        ));
      }
    } catch (error) {
      if (token === viewRequestToken && api.getPageId() === identity.pageId) {
        api.reportViewLoadError(error);
      }
    }
  }

  api = createAnnotator({
    window: windowObject,
    document: windowObject.document,
    scriptSrc: script?.src || "",
    explicitPageId: script?.dataset.pageId,
    explicitProjectId: script?.dataset.projectId,
    basePage,
    routes,
    requestView,
    onViewHydrated: () => {
      hydratedPageIds.add(api.getPageId());
    }
  });

  windowObject.PRDAnnotator = api;
  api.mount();
  if (initialError) api.reportViewLoadError(initialError);
  const activeIdentity = api.getSnapshot().locationIdentity;
  const initialIdentity = activeIdentity.viewSrc || !script?.dataset.viewSrc
    ? activeIdentity
    : { ...activeIdentity, viewSrc: script.dataset.viewSrc };
  const ready = requestView(initialIdentity).then(() => api);
  return { api, ready };
}

export function boot(windowObject = window) {
  if (windowObject.PRDAnnotator) return windowObject.PRDAnnotator;
  if (windowObject.PRDAnnotatorReady) return windowObject.PRDAnnotatorReady;

  const script = windowObject.document.currentScript;
  const routeSrc = script?.dataset.routeSrc;
  if (!routeSrc) {
    const { api, ready } = createMountedAnnotator({
      windowObject,
      script,
      basePage: undefined,
      routes: undefined
    });
    windowObject.PRDAnnotatorReady = ready;
    return api;
  }

  const fallback = fallbackBasePage(windowObject, script);
  const ready = loadRouteRegistryScript({
    window: windowObject,
    document: windowObject.document,
    src: routeSrc,
    expected: {
      projectId: script?.dataset.projectId,
      pageId: script?.dataset.pageId
    }
  }).then((registry) => createMountedAnnotator({
    windowObject,
    script,
    basePage: registry.basePage,
    routes: registry.routes
  }).ready).catch((error) => createMountedAnnotator({
    windowObject,
    script,
    basePage: fallback,
    routes: [],
    initialError: error
  }).ready);

  windowObject.PRDAnnotatorReady = ready;
  return ready;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  boot(window);
}
