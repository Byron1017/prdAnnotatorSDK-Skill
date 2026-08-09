import { SCHEMA_VERSION, SDK_VERSION } from "../constants.js";
import {
  normalizeRoute,
  resolvePageId,
  resolveProjectKey
} from "../identity.js";
import { describeTarget, isAnnotatable } from "../locator.js";
import { assertValidDocument, createEmptyDocument } from "../model.js";
import { createCacheStore, makeStorageKey } from "../storage.js";
import { createOverlayController } from "../ui/overlay.js";
import { createShell } from "../ui/shell.js";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createAnnotator({
  window,
  document,
  scriptSrc = "",
  explicitPageId,
  explicitProjectId
}) {
  const route = normalizeRoute(window.location?.pathname || "/");
  const pageId = resolvePageId({ explicitId: explicitPageId, pathname: route });
  const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
  const cache = createCacheStore({
    storage: window.localStorage,
    key: makeStorageKey(projectKey, pageId)
  });

  let documentState = createEmptyDocument({
    id: pageId,
    title: document.title || pageId,
    route
  });
  let pagePrdMarkdown = "";
  let shell = null;
  let disposers = [];
  let overlayController = null;
  let annotationModeActive = false;
  let pendingTarget = null;

  const cached = cache.load();
  try {
    if (cached?.schemaVersion === SCHEMA_VERSION) {
      assertValidDocument(cached.document);
      if (cached.document.page.id === pageId) {
        documentState = clone(cached.document);
        pagePrdMarkdown = typeof cached.pagePrdMarkdown === "string"
          ? cached.pagePrdMarkdown
          : "";
      }
    }
  } catch {
    // Invalid cache is ignored and never removed.
  }

  function getSnapshot() {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      projectKey,
      document: documentState,
      pagePrdMarkdown
    });
  }

  function mount() {
    if (shell?.host.isConnected) return;
    if (shell) unmount();

    shell = createShell(document);
    const mountedShell = shell;
    overlayController = createOverlayController({
      document,
      container: mountedShell.overlay
    });
    overlayController.renderMarkers(documentState.annotations);

    const comesFromSdk = (event) => event.composedPath().includes(mountedShell.host);
    const handlePointerMove = (event) => {
      if (comesFromSdk(event) || !isAnnotatable(event.target)) {
        overlayController?.hideHover();
        return;
      }
      overlayController?.showHover(event.target);
    };
    const handleTargetClick = (event) => {
      if (comesFromSdk(event) || !isAnnotatable(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingTarget = describeTarget(event.target);
      overlayController?.showHover(event.target);
    };
    const setAnnotationMode = (active) => {
      if (annotationModeActive === active) return;
      annotationModeActive = active;
      mountedShell.annotationButton.setAttribute("aria-pressed", String(active));
      if (active) {
        document.addEventListener("pointermove", handlePointerMove, true);
        document.addEventListener("click", handleTargetClick, true);
      } else {
        document.removeEventListener("pointermove", handlePointerMove, true);
        document.removeEventListener("click", handleTargetClick, true);
        overlayController?.hideHover();
        pendingTarget = null;
      }
    };
    const toggleAnnotation = () => {
      setAnnotationMode(!annotationModeActive);
    };
    const toggleDrawer = () => {
      const open = mountedShell.drawerButton.getAttribute("aria-expanded") === "true";
      mountedShell.drawerButton.setAttribute("aria-expanded", String(!open));
      mountedShell.drawer.hidden = open;
    };

    mountedShell.annotationButton.addEventListener("click", toggleAnnotation);
    mountedShell.drawerButton.addEventListener("click", toggleDrawer);
    disposers = [
      () => setAnnotationMode(false),
      () => mountedShell.annotationButton.removeEventListener("click", toggleAnnotation),
      () => mountedShell.drawerButton.removeEventListener("click", toggleDrawer),
      () => overlayController?.destroy()
    ];
    document.body.append(mountedShell.host);
  }

  function unmount() {
    for (const dispose of disposers.splice(0)) dispose();
    shell?.host.remove();
    overlayController = null;
    annotationModeActive = false;
    pendingTarget = null;
    shell = null;
  }

  const api = {
    version: SDK_VERSION,
    mount,
    unmount,
    isMounted: () => Boolean(shell?.host.isConnected),
    getPageId: () => documentState.page.id,
    getSnapshot,
    hydrate: () => getSnapshot()
  };

  return Object.freeze(api);
}
