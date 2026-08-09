import { SCHEMA_VERSION, SDK_VERSION } from "../constants.js";
import {
  normalizeRoute,
  resolvePageId,
  resolveProjectKey
} from "../identity.js";
import { describeTarget, isAnnotatable } from "../locator.js";
import {
  assertValidDocument,
  createEmptyDocument,
  mergeAnnotationDocuments
} from "../model.js";
import { observeNavigation } from "./navigation.js";
import { createCacheStore, makeStorageKey } from "../storage.js";
import { renderAnnotationList, renderPagePrd } from "../ui/drawer.js";
import { closeEditor, openEditor } from "../ui/editor.js";
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
  explicitProjectId,
  now = () => new Date().toISOString()
}) {
  const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
  let currentRoute = normalizeRoute(window.location?.pathname || "/");
  let currentPageId = resolvePageId({
    explicitId: explicitPageId,
    pathname: currentRoute
  });
  let cache = createCacheStore({
    storage: window.localStorage,
    key: makeStorageKey(projectKey, currentPageId)
  });

  let documentState = createEmptyDocument({
    id: currentPageId,
    title: document.title || currentPageId,
    route: currentRoute
  });
  let pagePrdMarkdown = "";
  let shell = null;
  let disposers = [];
  let overlayController = null;
  let annotationModeActive = false;
  let pendingTarget = null;

  function loadCurrentPage() {
    documentState = createEmptyDocument({
      id: currentPageId,
      title: document.title || currentPageId,
      route: currentRoute
    });
    pagePrdMarkdown = "";

    const cached = cache.load();
    try {
      if (cached?.schemaVersion === SCHEMA_VERSION) {
        assertValidDocument(cached.document);
        if (cached.document.page.id === currentPageId) {
          documentState = {
            ...clone(cached.document),
            page: {
              ...clone(cached.document.page),
              route: currentRoute
            }
          };
          pagePrdMarkdown = typeof cached.pagePrdMarkdown === "string"
            ? cached.pagePrdMarkdown
            : "";
        }
      }
    } catch {
      // Invalid cache is ignored and never removed.
    }
  }

  loadCurrentPage();

  function getSnapshot() {
    return clone({
      schemaVersion: SCHEMA_VERSION,
      projectKey,
      document: documentState,
      pagePrdMarkdown
    });
  }

  function persistCache() {
    cache.save({
      schemaVersion: SCHEMA_VERSION,
      document: documentState,
      pagePrdMarkdown
    });
  }

  function nextAnnotationId() {
    const highest = documentState.annotations.reduce((maximum, annotation) => {
      const match = /^A(\d+)$/.exec(annotation.id);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    return `A${String(highest + 1).padStart(3, "0")}`;
  }

  function renderAll() {
    if (!shell) return;
    shell.pageTitle.textContent = documentState.page.title;
    shell.annotationCount.textContent = String(documentState.annotations.length);
    renderAnnotationList(shell.annotationList, documentState);
    renderPagePrd(shell.prdContent, pagePrdMarkdown);
    overlayController?.renderMarkers(documentState.annotations);
  }

  function closeCurrentEditor() {
    if (shell) closeEditor(shell.editor);
    pendingTarget = null;
    overlayController?.hideHover();
  }

  function savePendingAnnotation(comment) {
    if (!pendingTarget) return;
    const timestamp = now();
    const annotation = {
      id: nextAnnotationId(),
      comment,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
      target: clone(pendingTarget),
      prd: {
        linkedSections: [],
        impactScope: "page",
        summary: ""
      }
    };

    documentState = {
      ...documentState,
      annotations: [...documentState.annotations, annotation]
    };
    persistCache();
    closeCurrentEditor();
    renderAll();
  }

  function hydrate(input) {
    assertValidDocument(input?.document);
    documentState = mergeAnnotationDocuments(documentState, input.document);
    if (typeof input.pagePrdMarkdown === "string") {
      pagePrdMarkdown = input.pagePrdMarkdown;
    }
    persistCache();
    renderAll();
    return getSnapshot();
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
    renderAll();

    const comesFromSdk = (event) => event.composedPath().includes(mountedShell.host);
    const stopIfDetached = () => {
      if (mountedShell.host.isConnected) return false;
      setAnnotationMode(false);
      return true;
    };
    const handlePointerMove = (event) => {
      if (stopIfDetached()) return;
      if (comesFromSdk(event) || !isAnnotatable(event.target)) {
        overlayController?.hideHover();
        return;
      }
      overlayController?.showHover(event.target);
    };
    const handleTargetClick = (event) => {
      if (stopIfDetached()) return;
      if (comesFromSdk(event) || !isAnnotatable(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingTarget = describeTarget(event.target);
      overlayController?.showHover(event.target);
      openEditor({
        container: mountedShell.editor,
        target: pendingTarget,
        onSave: savePendingAnnotation,
        onCancel: closeCurrentEditor
      });
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
      if (!open) renderAll();
      mountedShell.drawerButton.setAttribute("aria-expanded", String(!open));
      mountedShell.drawer.hidden = open;
    };
    const closeDrawer = () => {
      mountedShell.drawerButton.setAttribute("aria-expanded", "false");
      mountedShell.drawer.hidden = true;
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (!mountedShell.editor.hidden) {
        closeCurrentEditor();
        mountedShell.annotationButton.focus();
      } else if (annotationModeActive) {
        setAnnotationMode(false);
        mountedShell.annotationButton.focus();
      } else if (!mountedShell.drawer.hidden) {
        closeDrawer();
        mountedShell.drawerButton.focus();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const stopNavigation = observeNavigation(window, (pathname) => {
      if (!mountedShell.host.isConnected) {
        stopNavigation();
        return;
      }

      const nextRoute = normalizeRoute(pathname);
      if (nextRoute === currentRoute) return;

      persistCache();
      currentRoute = nextRoute;
      currentPageId = resolvePageId({
        explicitId: explicitPageId,
        pathname: currentRoute
      });
      cache = createCacheStore({
        storage: window.localStorage,
        key: makeStorageKey(projectKey, currentPageId)
      });
      loadCurrentPage();
      closeCurrentEditor();
      setAnnotationMode(false);
      closeDrawer();
      renderAll();
    });

    mountedShell.annotationButton.addEventListener("click", toggleAnnotation);
    mountedShell.drawerButton.addEventListener("click", toggleDrawer);
    mountedShell.closeDrawerButton.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", handleKeyDown, true);
    disposers = [
      () => setAnnotationMode(false),
      closeCurrentEditor,
      stopNavigation,
      () => document.removeEventListener("keydown", handleKeyDown, true),
      () => mountedShell.annotationButton.removeEventListener("click", toggleAnnotation),
      () => mountedShell.drawerButton.removeEventListener("click", toggleDrawer),
      () => mountedShell.closeDrawerButton.removeEventListener("click", closeDrawer),
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
    hydrate
  };

  return Object.freeze(api);
}
