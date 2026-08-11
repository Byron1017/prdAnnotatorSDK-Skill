import { SCHEMA_VERSION, SDK_VERSION } from "../constants.js";
import { fingerprintValue } from "../fingerprint.js";
import {
  normalizeRoute,
  resolveLegacyPageId,
  resolvePageIdFromSeed,
  resolvePageId,
  resolveProjectKey
} from "../identity.js";
import { resolveLocationIdentity } from "../route-identity.js";
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
  renderDocumentsByGroup,
  renderPageMetadata,
  renderPagePrd,
  renderSyncHelp,
  renderSyncState,
  renderViewWarning
} from "../ui/drawer.js";
import { closeEditor, openEditor } from "../ui/editor.js";
import { createOverlayController } from "../ui/overlay.js";
import { createShell } from "../ui/shell.js";
import { createTabController } from "../ui/tabs.js";
import { buildSyncPrompt, computeSyncState } from "../sync-prompt.js";

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
  basePage,
  routes = [],
  requestView = () => {},
  onViewHydrated = () => {},
  now = () => new Date().toISOString()
}) {
  const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
  const hasConfiguredBasePage = Boolean(basePage);

  function documentBasePage(pathname) {
    const route = normalizeRoute(pathname || "/");
    const id = resolvePageId({
      explicitId: explicitPageId,
      pathname: route
    });
    return {
      id,
      title: document.title || id,
      htmlPath: route.replace(/^\/+/, "") || "index.html",
      viewSrc: ""
    };
  }

  function resolveActiveIdentity(location = window.location) {
    const pathname = location?.pathname || "/";
    return resolveLocationIdentity({
      pathname,
      hash: location?.hash || "",
      basePage: hasConfiguredBasePage ? basePage : documentBasePage(pathname),
      routes
    });
  }

  let currentIdentity = resolveActiveIdentity();
  let currentRoute = currentIdentity.routePattern || currentIdentity.route;
  let currentPageId = currentIdentity.pageId;

  function currentPage() {
    return {
      id: currentPageId,
      title: currentIdentity.title || document.title || currentPageId,
      htmlPath: currentIdentity.htmlPath,
      route: currentRoute
    };
  }

  function currentDocumentDefaults() {
    return { projectId: projectKey, page: currentPage() };
  }

  function quarantinedFallbackPageId() {
    if (currentIdentity.mode !== "hash-route" || !currentIdentity.registered) {
      return null;
    }
    return resolvePageIdFromSeed({
      slug: "unknown",
      seed: `${normalizeRoute(window.location?.pathname || "/")}#${currentIdentity.route}`
    });
  }

  function createPageCache() {
    const quarantinedPageId = quarantinedFallbackPageId();
    return createCacheStore({
      storage: window.localStorage,
      key: makeStorageKey(projectKey, currentPageId),
      fallbackKeys: [
        ...makeLegacyStorageKeys({
          projectId: projectKey,
          pageId: currentPageId,
          scriptSrc,
          pathname: currentRoute,
          hasExplicitProjectId: Boolean(explicitProjectId)
        }),
        ...(quarantinedPageId && quarantinedPageId !== currentPageId
          ? [makeStorageKey(projectKey, quarantinedPageId)]
          : [])
      ]
    });
  }

  let cache = createPageCache();

  let documentState = createEmptyDocument(currentDocumentDefaults());
  let pagePrdMarkdown = "";
  let viewDocuments = [];
  let persistedAnnotationFingerprint = "";
  let viewGeneratedAt = "";
  let viewLoadError = null;
  const registeredViews = new Map();
  let shell = null;
  let disposers = [];
  let overlayController = null;
  let tabController = null;
  let annotationModeActive = false;
  let pendingTarget = null;
  let copyResult = "";
  let showSyncPromptFallback = false;

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
        const isMatchingQuarantinedV2Cache = cached.schemaVersion === SCHEMA_VERSION
          && cached.document.schemaVersion === SCHEMA_VERSION
          && legacyProjectId === projectKey
          && rawPageId === quarantinedFallbackPageId();
        if (
          isMatchingCurrentV2Cache
          || isMatchingLegacyCache
          || isMatchingQuarantinedV2Cache
        ) {
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
            || cached.document.schemaVersion !== SCHEMA_VERSION
            || isMatchingQuarantinedV2Cache) {
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
      persistedAnnotationFingerprint,
      annotationFingerprint: fingerprintValue(documentState.annotations),
      locationIdentity: currentIdentity
    });
  }

  function getSyncPrompt() {
    return buildSyncPrompt({
      projectId: projectKey,
      pageId: documentState.page.id,
      htmlPath: documentState.page.htmlPath,
      manifestPath: ".prd-annotator/manifest.json",
      annotationPath: `.prd-annotator/data/pages/${documentState.page.id}.json`,
      viewPath: `.prd-annotator/view/pages/${documentState.page.id}.js`,
      fingerprint: fingerprintValue(documentState.annotations),
      document: clone(documentState)
    });
  }

  function getSyncState() {
    return computeSyncState({
      currentFingerprint: fingerprintValue(documentState.annotations),
      persistedFingerprint: persistedAnnotationFingerprint,
      cacheStatus: cache.getStatus()
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
    renderDocumentsByGroup(shell.documentContainers, viewDocuments, documentState.page.id);
    renderSyncState(shell.syncState, getSyncState());
    renderSyncHelp(shell.syncHelp, {
      prompt: getSyncPrompt(),
      copyResult,
      showFallback: showSyncPromptFallback,
      onCopy: copySyncPrompt
    });
    renderViewWarning(shell.viewWarning, viewLoadError);
    overlayController?.renderMarkers(documentState.annotations);
  }

  function closeCurrentEditor() {
    if (shell) closeEditor(shell.editor);
    pendingTarget = null;
    overlayController?.hideHover();
  }

  async function copySyncPrompt() {
    const prompt = getSyncPrompt();
    try {
      const writeText = window.navigator?.clipboard?.writeText;
      if (typeof writeText !== "function") throw new Error("Clipboard API unavailable");
      await writeText.call(window.navigator.clipboard, prompt);
      copyResult = "提示词已复制。请返回 AI Agent 粘贴并发送；复制不代表同步成功。";
      showSyncPromptFallback = false;
    } catch {
      copyResult = "无法自动复制。请手动复制提示词后返回 AI Agent 粘贴并发送；复制不代表同步成功。";
      showSyncPromptFallback = true;
    }
    renderAll();
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
    const activeIdentity = currentDocumentDefaults();
    const hydratedDocument = normalizeAnnotationDocument(
      input?.document,
      activeIdentity
    );
    assertValidDocument(hydratedDocument);
    if (
      hydratedDocument.projectId !== activeIdentity.projectId
      || hydratedDocument.page.id !== activeIdentity.page.id
      || hydratedDocument.page.title !== activeIdentity.page.title
      || hydratedDocument.page.htmlPath !== activeIdentity.page.htmlPath
      || hydratedDocument.page.route !== activeIdentity.page.route
    ) {
      throw new Error("Hydrated document identity does not match active annotator");
    }
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

  function registerView(bundle) {
    const validated = assertValidViewBundle(bundle, {
      projectId: projectKey
    });
    registeredViews.set(validated.page.id, clone(validated));
    if (validated.page.id === currentPageId) {
      return hydrateView(validated);
    }
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
    tabController = createTabController({ tabs: mountedShell.tabs, panels: mountedShell.panels });
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
    const stopNavigation = observeNavigation(window, (location) => {
      if (!mountedShell.host.isConnected) {
        stopNavigation();
        return;
      }

      const nextIdentity = resolveActiveIdentity(location);
      if (nextIdentity.pageId === currentPageId) {
        currentIdentity = nextIdentity;
        currentRoute = nextIdentity.routePattern || nextIdentity.route;
        return;
      }

      persistCache();
      currentIdentity = nextIdentity;
      currentRoute = nextIdentity.routePattern || nextIdentity.route;
      currentPageId = nextIdentity.pageId;
      cache = createPageCache();
      loadCurrentPage();
      closeCurrentEditor();
      setAnnotationMode(false);
      closeDrawer();
      tabController.reset();
      renderAll();
      requestView(clone(nextIdentity));
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
    tabController = null;
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
    getSyncPrompt,
    hydrate,
    hydrateView,
    registerView,
    reportViewLoadError
  };

  return Object.freeze(api);
}
