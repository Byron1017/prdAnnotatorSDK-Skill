import { SCHEMA_VERSION, SDK_VERSION } from "../constants.js";
import {
  normalizeRoute,
  resolveLegacyPageId,
  resolvePageId,
  resolveProjectKey
} from "../identity.js";
import { describeTarget, isAnnotatable } from "../locator.js";
import {
  assertValidDocument,
  createEmptyDocument,
  mergeAnnotationDocuments,
  normalizeAnnotationDocument
} from "../model.js";
import { observeNavigation } from "./navigation.js";
import {
  createCacheStore,
  makeLegacyStorageKeys,
  makeStorageKey
} from "../storage.js";
import { assertValidViewBundle, assertValidViewDocuments } from "../view-data.js";
import {
  renderAnnotationList,
  renderDocumentGroups,
  renderPageMetadata,
  renderPagePrd,
  renderViewWarning
} from "../ui/drawer.js";
import { closeEditor, openEditor } from "../ui/editor.js";
import { createOverlayController } from "../ui/overlay.js";
import { createShell } from "../ui/shell.js";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function createAnnotation(formValue, target, id, timestamp) {
  return {
    id,
    title: formValue.title,
    description: formValue.description,
    type: formValue.type,
    prdContent: formValue.prdContent,
    acceptanceCriteria: formValue.acceptanceCriteria,
    dataFields: formValue.dataFields,
    apiPath: formValue.apiPath,
    edgeCases: formValue.edgeCases,
    status: "open",
    createdAt: timestamp,
    updatedAt: timestamp,
    target: clone(target),
    prd: {
      linkedDocuments: [],
      linkedSections: [],
      impactScope: "page",
      summary: ""
    }
  };
}

export function createAnnotator({
  window,
  document,
  scriptSrc = "",
  explicitPageId,
  explicitProjectId,
  onViewHydrated = () => {},
  now = () => new Date().toISOString()
}) {
  const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
  let currentRoute = normalizeRoute(window.location?.pathname || "/");
  let currentPageId = resolvePageId({
    explicitId: explicitPageId,
    pathname: currentRoute
  });

  function currentPage() {
    return {
      id: currentPageId,
      title: document.title || currentPageId,
      htmlPath: currentRoute.replace(/^\/+/, "") || "index.html",
      route: currentRoute
    };
  }

  function currentDocumentDefaults() {
    return { projectId: projectKey, page: currentPage() };
  }

  function createPageCache() {
    return createCacheStore({
      storage: window.localStorage,
      key: makeStorageKey(projectKey, currentPageId),
      fallbackKeys: makeLegacyStorageKeys({
        projectId: projectKey,
        pageId: currentPageId,
        scriptSrc,
        pathname: currentRoute,
        hasExplicitProjectId: Boolean(explicitProjectId)
      })
    });
  }

  let cache = createPageCache();

  let documentState = createEmptyDocument(currentDocumentDefaults());
  let pagePrdMarkdown = "";
  let viewDocuments = [];
  let persistedAnnotationFingerprint = "";
  let viewGeneratedAt = "";
  let viewLoadError = null;
  let shell = null;
  let disposers = [];
  let overlayController = null;
  let annotationModeActive = false;
  let pendingTarget = null;

  function loadCurrentPage() {
    documentState = createEmptyDocument(currentDocumentDefaults());
    pagePrdMarkdown = "";
    viewDocuments = [];
    persistedAnnotationFingerprint = "";
    viewGeneratedAt = "";
    viewLoadError = null;

    const cached = cache.load();
    try {
      if (cached?.document) {
        const cachedDocument = normalizeAnnotationDocument(
          cached.document,
          currentDocumentDefaults()
        );
        assertValidDocument(cachedDocument);
        const legacyProjectId = cached.document.projectId || cached.projectKey;
        const rawPageId = cached.document.page?.id;
        const isMatchingCurrentV2Cache = cached.schemaVersion === SCHEMA_VERSION
          && cached.document.schemaVersion === SCHEMA_VERSION
          && legacyProjectId === projectKey
          && rawPageId === currentPageId;
        const isMatchingLegacyCache = cached.schemaVersion === 1
          && (!legacyProjectId || legacyProjectId === projectKey)
          && rawPageId === resolveLegacyPageId({
            explicitId: explicitPageId,
            pathname: currentRoute
          });
        if (isMatchingCurrentV2Cache || isMatchingLegacyCache) {
          documentState = {
            ...clone(cachedDocument),
            page: {
              ...clone(cachedDocument.page),
              ...currentPage()
            }
          };
          pagePrdMarkdown = typeof cached.pagePrdMarkdown === "string"
            ? cached.pagePrdMarkdown
            : "";
          try {
            viewDocuments = clone(assertValidViewDocuments(cached.viewDocuments || []));
          } catch {
            viewDocuments = [];
          }
          persistedAnnotationFingerprint = typeof cached.persistedAnnotationFingerprint === "string"
            ? cached.persistedAnnotationFingerprint
            : "";
          viewGeneratedAt = typeof cached.viewGeneratedAt === "string" ? cached.viewGeneratedAt : "";
          if (cached.schemaVersion !== SCHEMA_VERSION
            || cached.document.schemaVersion !== SCHEMA_VERSION) {
            persistCache();
          }
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
      projectId: projectKey,
      document: documentState,
      pagePrdMarkdown,
      documents: viewDocuments,
      persistedAnnotationFingerprint
    });
  }

  function persistCache() {
    cache.save({
      schemaVersion: SCHEMA_VERSION,
      document: documentState,
      pagePrdMarkdown,
      viewDocuments,
      persistedAnnotationFingerprint,
      viewGeneratedAt
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
    renderPageMetadata(shell.pageMetadata, documentState.page, viewGeneratedAt);
    renderDocumentGroups(shell.documentGroups, viewDocuments, documentState.page.id);
    renderViewWarning(shell.viewWarning, viewLoadError);
    overlayController?.renderMarkers(documentState.annotations);
  }

  function closeCurrentEditor() {
    if (shell) closeEditor(shell.editor);
    pendingTarget = null;
    overlayController?.hideHover();
  }

  function savePendingAnnotation(formValue) {
    if (!pendingTarget) return;
    const timestamp = now();
    const annotation = createAnnotation(
      formValue,
      pendingTarget,
      nextAnnotationId(),
      timestamp
    );

    documentState = {
      ...documentState,
      annotations: [...documentState.annotations, annotation]
    };
    persistCache();
    closeCurrentEditor();
    renderAll();
  }

  function hydrate(input) {
    const hydratedDocument = normalizeAnnotationDocument(
      input?.document,
      currentDocumentDefaults()
    );
    assertValidDocument(hydratedDocument);
    documentState = mergeAnnotationDocuments(documentState, hydratedDocument);
    if (typeof input.pagePrdMarkdown === "string") {
      pagePrdMarkdown = input.pagePrdMarkdown;
    }
    persistCache();
    renderAll();
    return getSnapshot();
  }

  function hydrateView(bundle) {
    const viewBundle = assertValidViewBundle(bundle, {
      projectId: projectKey,
      pageId: currentPageId
    });
    documentState = mergeAnnotationDocuments(documentState, viewBundle.document);
    viewDocuments = clone(viewBundle.documents);
    persistedAnnotationFingerprint = viewBundle.persistedAnnotationFingerprint;
    viewGeneratedAt = viewBundle.generatedAt;
    viewLoadError = null;
    persistCache();
    renderAll();
    onViewHydrated();
    return getSnapshot();
  }

  function reportViewLoadError(error) {
    viewLoadError = error instanceof Error ? error : new Error(String(error || "view data missing"));
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
      cache = createPageCache();
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
    hydrate,
    hydrateView,
    reportViewLoadError
  };

  return Object.freeze(api);
}
