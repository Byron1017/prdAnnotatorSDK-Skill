import { SCHEMA_VERSION, SDK_VERSION } from "../constants.js";
import {
  normalizeRoute,
  resolvePageId,
  resolveProjectKey
} from "../identity.js";
import { assertValidDocument, createEmptyDocument } from "../model.js";
import { createCacheStore, makeStorageKey } from "../storage.js";
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

    shell = createShell(document);
    const toggleAnnotation = () => {
      const active = shell.annotationButton.getAttribute("aria-pressed") === "true";
      shell.annotationButton.setAttribute("aria-pressed", String(!active));
    };
    const toggleDrawer = () => {
      const open = shell.drawerButton.getAttribute("aria-expanded") === "true";
      shell.drawerButton.setAttribute("aria-expanded", String(!open));
      shell.drawer.hidden = open;
    };

    shell.annotationButton.addEventListener("click", toggleAnnotation);
    shell.drawerButton.addEventListener("click", toggleDrawer);
    disposers = [
      () => shell?.annotationButton.removeEventListener("click", toggleAnnotation),
      () => shell?.drawerButton.removeEventListener("click", toggleDrawer)
    ];
    document.body.append(shell.host);
  }

  function unmount() {
    for (const dispose of disposers.splice(0)) dispose();
    shell?.host.remove();
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
