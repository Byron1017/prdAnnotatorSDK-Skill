/*! PRD Annotator SDK v2.4.0 */
(() => {
  // prd-annotator/src/constants.js
  var SDK_VERSION = "2.4.0";
  var SCHEMA_VERSION = 2;
  var UI_ATTRIBUTE = "data-prd-annotator-ui";
  var ANNOTATION_STATUSES = Object.freeze([
    "open",
    "needs-clarification",
    "applied",
    "superseded"
  ]);
  var IMPACT_SCOPES = Object.freeze(["page", "global"]);
  var ANNOTATION_TYPES = Object.freeze([
    "requirement",
    "change",
    "question",
    "bug"
  ]);
  var STORAGE_PREFIX = "prd-annotator:v2";
  var LEGACY_STORAGE_PREFIX = "prd-annotator:v1";

  // prd-annotator/src/fingerprint.js
  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }
  function fingerprintValue(value) {
    let hash = 2166136261;
    for (const character of canonicalJson(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
  }

  // prd-annotator/src/identity.js
  function fnv1a(value, seed = 2166136261) {
    let hash = seed >>> 0;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function stableHex(value, length) {
    return `${fnv1a(value)}${fnv1a(`prd:${value}`, 2654435769)}`.slice(0, length);
  }
  function normalizeRoute(pathname = "/") {
    const pathOnly = String(pathname).split(/[?#]/, 1)[0] || "/";
    const normalized = `/${pathOnly}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return normalized || "/";
  }
  function cleanAscii(value, maxLength = 40) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, maxLength).replace(/-$/g, "");
  }
  function resolvePageIdFromSeed({ slug = "page", seed = "" } = {}) {
    const cleanSlug = cleanAscii(slug, 25) || "page";
    return `${cleanSlug}-${stableHex(String(seed), 6)}`.slice(0, 32);
  }
  function resolveLegacyPageId({ explicitId, pathname = "/", manifestPages = [] }) {
    const explicit = cleanAscii(explicitId);
    if (explicit) return explicit;
    const route = normalizeRoute(pathname);
    const existing = manifestPages.find((page) => normalizeRoute(page.route) === route);
    const existingId = cleanAscii(existing?.id);
    if (existingId) return existingId;
    const segments = route.split("/").filter(Boolean).reverse();
    const slug = segments.map((segment) => cleanAscii(segment, 26)).find(Boolean);
    return slug ? `p-${slug}-${stableHex(route, 6)}`.slice(0, 40) : `p-${stableHex(route, 10)}`;
  }
  function resolvePageId({ explicitId, pathname = "/", manifestPages = [] }) {
    const explicit = cleanAscii(explicitId, 32);
    if (explicit) return explicit;
    const route = normalizeRoute(pathname);
    const existing = manifestPages.find((page) => normalizeRoute(page.route) === route);
    const existingId = cleanAscii(existing?.id, 32);
    if (existingId) return existingId;
    const segments = route.split("/").filter(Boolean).reverse();
    const slug = segments.map((segment) => cleanAscii(segment.replace(/\.[^.]+$/, ""), 25)).find(Boolean);
    return slug ? `${slug}-${stableHex(route, 6)}`.slice(0, 32) : `page-${stableHex(route, 6)}`;
  }
  function resolveLegacyProjectKey({ explicitProjectId, scriptSrc = "" }) {
    const explicit = cleanAscii(explicitProjectId, 48);
    if (explicit) return explicit;
    const sdkDirectory = String(scriptSrc).replace(/[^/]*$/, "");
    return `project-${stableHex(sdkDirectory, 10)}`;
  }
  function resolveProjectKey(options) {
    return resolveLegacyProjectKey(options);
  }

  // prd-annotator/src/route-identity.js
  function normalizeHashLocation(hash = "") {
    const raw = String(hash || "");
    if (!raw || raw === "#") return { kind: "none", path: "" };
    const body = raw.startsWith("#!") ? raw.slice(2) : raw.slice(1);
    if (!body.startsWith("/")) return { kind: "anchor", path: body };
    return { kind: "route", path: normalizeRoute(body) };
  }
  function patternSegments(pattern) {
    const normalized = `/${String(pattern || "")}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    return normalized.split("/").filter(Boolean);
  }
  function matchRoutePattern(pattern, candidate) {
    const expected = patternSegments(pattern);
    const actual = patternSegments(candidate);
    let actualIndex = 0;
    for (const segment of expected) {
      if (/^:[a-zA-Z_][\w]*(?:\(\.\*\))?\*$/.test(segment)) return true;
      const optional = /^:[a-zA-Z_][\w]*\?$/.test(segment);
      if (optional && actualIndex >= actual.length) continue;
      if (actualIndex >= actual.length) return false;
      if (!segment.startsWith(":") && segment !== actual[actualIndex]) return false;
      actualIndex += 1;
    }
    return actualIndex === actual.length;
  }
  function resolveLocationIdentity({
    pathname = "/",
    hash = "",
    basePage,
    routes = []
  }) {
    const hashLocation = normalizeHashLocation(hash);
    if (hashLocation.kind !== "route") {
      return {
        ...basePage,
        pageId: basePage.id,
        route: normalizeRoute(pathname),
        routePattern: null,
        mode: "document",
        registered: true
      };
    }
    const matches = routes.filter((entry) => matchRoutePattern(entry.routePattern, hashLocation.path));
    if (matches.length > 1) {
      throw new Error(`Ambiguous PRD Annotator route: ${hashLocation.path}`);
    }
    if (matches.length === 1) {
      const page = matches[0];
      return {
        ...page,
        pageId: page.id,
        htmlPath: basePage.htmlPath,
        route: hashLocation.path,
        routePattern: page.routePattern,
        mode: "hash-route",
        registered: true
      };
    }
    const pageId = resolvePageIdFromSeed({
      slug: "unknown",
      seed: `${normalizeRoute(pathname)}#${hashLocation.path}`
    });
    return {
      pageId,
      title: hashLocation.path,
      htmlPath: basePage.htmlPath,
      route: hashLocation.path,
      routePattern: null,
      mode: "hash-route",
      registered: false,
      viewSrc: ""
    };
  }

  // prd-annotator/src/locator.js
  var BLOCKED_TAGS = /* @__PURE__ */ new Set([
    "HTML",
    "BODY",
    "SCRIPT",
    "STYLE",
    "LINK",
    "META"
  ]);
  function normalizedText(element) {
    return element.textContent.replace(/\s+/g, " ").trim();
  }
  function elementDepth(element) {
    let depth = 0;
    for (let node = element; node?.parentElement; node = node.parentElement) depth += 1;
    return depth;
  }
  function isAnnotatable(element) {
    const ElementConstructor = element?.ownerDocument?.defaultView?.Element;
    if (!ElementConstructor || !(element instanceof ElementConstructor)) return false;
    if (element.closest(`[${UI_ATTRIBUTE}]`)) return false;
    const rootHost = element.getRootNode()?.host;
    if (rootHost?.closest?.(`[${UI_ATTRIBUTE}]`)) return false;
    return !BLOCKED_TAGS.has(element.tagName);
  }
  function cssSegment(element) {
    const escape = element.ownerDocument.defaultView.CSS?.escape || ((value) => value.replace(/[^A-Za-z0-9_-]/g, "\\$&"));
    if (element.id && /^[A-Za-z][\w:-]*$/.test(element.id)) {
      return `#${escape(element.id)}`;
    }
    const siblings = [...element.parentElement?.children || []].filter((node) => node.tagName === element.tagName);
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : "";
    return `${element.tagName.toLowerCase()}${suffix}`;
  }
  function createCssPath(element) {
    const segments = [];
    const documentElement = element.ownerDocument.documentElement;
    for (let node = element; node && node !== documentElement; node = node.parentElement) {
      segments.unshift(cssSegment(node));
      if (segments[0].startsWith("#")) break;
    }
    return segments.join(" > ");
  }
  function createXpath(element) {
    const segments = [];
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const peers = [...node.parentElement?.children || []].filter((peer) => peer.tagName === node.tagName);
      const index = peers.length > 1 ? `[${peers.indexOf(node) + 1}]` : "";
      segments.unshift(`${node.tagName.toLowerCase()}${index}`);
    }
    return `/${segments.join("/")}`;
  }
  function describeTarget(element) {
    if (!isAnnotatable(element)) throw new Error("Element is not annotatable");
    const rect = element.getBoundingClientRect();
    return {
      cssPath: createCssPath(element),
      xpath: createXpath(element),
      textQuote: normalizedText(element).slice(0, 160),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  }
  function resolveTarget(document2, descriptor) {
    try {
      const byCss = document2.querySelector(descriptor.cssPath);
      if (isAnnotatable(byCss)) return byCss;
    } catch {
    }
    try {
      const XPathResult = document2.defaultView.XPathResult;
      const result = document2.evaluate(
        descriptor.xpath,
        document2,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE
      );
      if (isAnnotatable(result.singleNodeValue)) return result.singleNodeValue;
    } catch {
    }
    const quote = String(descriptor.textQuote || "").replace(/\s+/g, " ").trim();
    if (!quote) return null;
    return [...document2.querySelectorAll("body *")].filter(isAnnotatable).filter((element) => normalizedText(element).includes(quote)).sort((left, right) => {
      const lengthDelta = normalizedText(left).length - normalizedText(right).length;
      if (lengthDelta) return lengthDelta;
      return elementDepth(right) - elementDepth(left);
    })[0] || null;
  }

  // prd-annotator/src/model.js
  var OPTIONAL_ANNOTATION_TEXT_FIELDS = [
    "note",
    "acceptanceCriteria",
    "dataFields",
    "apiPath",
    "edgeCases"
  ];
  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }
  function asPage(value = {}, defaults = {}) {
    const route = String(value.route || defaults.route || "/");
    return {
      id: String(value.id || defaults.id || ""),
      title: String(value.title || defaults.title || value.id || defaults.id || ""),
      htmlPath: String(value.htmlPath || defaults.htmlPath || "/"),
      route
    };
  }
  function normalizeAnnotation(annotation = {}) {
    const comment = String(annotation.comment || "");
    const prd = annotation.prd || {};
    return {
      ...clone(annotation),
      id: String(annotation.id || ""),
      title: String(annotation.title || comment),
      description: String(annotation.description || comment),
      type: ANNOTATION_TYPES.includes(annotation.type) ? annotation.type : "requirement",
      prdContent: String(annotation.prdContent || comment),
      status: ANNOTATION_STATUSES.includes(annotation.status) ? annotation.status : "open",
      createdAt: String(annotation.createdAt || ""),
      updatedAt: String(annotation.updatedAt || annotation.createdAt || ""),
      target: clone(annotation.target || {
        cssPath: "",
        xpath: "",
        textQuote: "",
        rect: { x: 0, y: 0, width: 0, height: 0 }
      }),
      prd: {
        ...clone(prd),
        linkedDocuments: Array.isArray(prd.linkedDocuments) ? clone(prd.linkedDocuments) : [],
        linkedSections: Array.isArray(prd.linkedSections) ? clone(prd.linkedSections) : [],
        impactScope: IMPACT_SCOPES.includes(prd.impactScope) ? prd.impactScope : "page",
        summary: String(prd.summary || "")
      }
    };
  }
  function normalizeDeletedAnnotation(value = {}) {
    return {
      id: String(value.id || ""),
      deletedAt: String(value.deletedAt || "")
    };
  }
  function assertIsoTimestamp(value, label) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
      throw new Error(`Invalid ${label}`);
    }
  }
  function annotationFingerprintInput(document2 = {}) {
    const annotations = clone(
      Array.isArray(document2.annotations) ? document2.annotations : []
    );
    const deletedAnnotations = clone(
      Array.isArray(document2.deletedAnnotations) ? document2.deletedAnnotations : []
    );
    return deletedAnnotations.length ? { annotations, deletedAnnotations } : annotations;
  }
  function annotationDisplayNumber(annotation, fallbackIndex = 0) {
    const match = /^A(\d+)$/.exec(String(annotation?.id || ""));
    return match ? String(Number(match[1])) : String(fallbackIndex + 1);
  }
  function createEmptyDocument(options = {}) {
    const { projectId, page } = options;
    const pageValue = page || options;
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: projectId === void 0 ? void 0 : String(projectId),
      page: asPage(pageValue),
      annotations: [],
      deletedAnnotations: [],
      managedPrd: null
    };
  }
  function normalizeAnnotationDocument(value, defaults = {}) {
    const source = value || {};
    const pageDefaults = defaults.page || defaults;
    return {
      ...clone(source),
      schemaVersion: SCHEMA_VERSION,
      projectId: String(source.projectId || defaults.projectId || ""),
      page: asPage(source.page, pageDefaults),
      annotations: Array.isArray(source.annotations) ? source.annotations.map(normalizeAnnotation) : [],
      deletedAnnotations: Array.isArray(source.deletedAnnotations) ? source.deletedAnnotations.map(normalizeDeletedAnnotation) : [],
      managedPrd: source.managedPrd === void 0 ? null : clone(source.managedPrd)
    };
  }
  function assertValidDocument(document2) {
    if (document2?.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("Unsupported schemaVersion");
    }
    if (!document2.page?.id || !/^[a-z0-9-]{1,32}$/.test(document2.page.id)) {
      throw new Error("Invalid page.id");
    }
    if (!Array.isArray(document2.annotations)) {
      throw new Error("annotations must be an array");
    }
    if (document2.deletedAnnotations !== void 0 && !Array.isArray(document2.deletedAnnotations)) {
      throw new Error("deletedAnnotations must be an array");
    }
    const activeIds = /* @__PURE__ */ new Set();
    for (const annotation of document2.annotations) {
      if (!annotation.id || !annotation.title || !annotation.description || !annotation.prdContent || !annotation.target) {
        throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
      }
      for (const field of OPTIONAL_ANNOTATION_TEXT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(annotation, field) && typeof annotation[field] !== "string") {
          throw new Error(`Invalid annotation ${annotation.id}.${field}`);
        }
      }
      if (!["cssPath", "xpath", "textQuote"].some(
        (field) => typeof annotation.target[field] === "string" && annotation.target[field].trim()
      )) {
        throw new Error(`Invalid annotation ${annotation.id}.target`);
      }
      if (!ANNOTATION_TYPES.includes(annotation.type)) {
        throw new Error("Invalid annotation type");
      }
      if (!ANNOTATION_STATUSES.includes(annotation.status)) {
        throw new Error("Invalid annotation status");
      }
      if (!IMPACT_SCOPES.includes(annotation.prd?.impactScope)) {
        throw new Error("Invalid impact scope");
      }
      activeIds.add(annotation.id);
    }
    const deletedIds = /* @__PURE__ */ new Set();
    for (const deletedAnnotation of document2.deletedAnnotations || []) {
      if (!deletedAnnotation.id) {
        throw new Error("Invalid deleted annotation id");
      }
      if (deletedIds.has(deletedAnnotation.id)) {
        throw new Error(`Duplicate deleted annotation ${deletedAnnotation.id}`);
      }
      if (activeIds.has(deletedAnnotation.id)) {
        throw new Error(`Annotation ${deletedAnnotation.id} cannot be active and deleted`);
      }
      assertIsoTimestamp(
        deletedAnnotation.deletedAt,
        `deleted annotation ${deletedAnnotation.id}.deletedAt`
      );
      deletedIds.add(deletedAnnotation.id);
    }
    return document2;
  }
  function mergeAnnotationDocuments(base, incoming) {
    const normalizedBase = normalizeAnnotationDocument(base);
    const normalizedIncoming = normalizeAnnotationDocument(incoming, {
      projectId: normalizedBase.projectId,
      page: normalizedBase.page
    });
    assertValidDocument(normalizedBase);
    assertValidDocument(normalizedIncoming);
    if (normalizedBase.page.id !== normalizedIncoming.page.id) {
      throw new Error("Cannot merge different pages");
    }
    const annotationsById = new Map(
      normalizedBase.annotations.map((item) => [item.id, clone(item)])
    );
    for (const candidate of normalizedIncoming.annotations) {
      const current = annotationsById.get(candidate.id);
      if (!current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)) {
        annotationsById.set(candidate.id, current ? { ...clone(current), ...clone(candidate) } : clone(candidate));
      }
    }
    const tombstonesById = new Map(
      normalizedBase.deletedAnnotations.map((item) => [item.id, clone(item)])
    );
    for (const candidate of normalizedIncoming.deletedAnnotations) {
      const current = tombstonesById.get(candidate.id);
      if (!current || Date.parse(candidate.deletedAt) >= Date.parse(current.deletedAt)) {
        tombstonesById.set(candidate.id, clone(candidate));
      }
    }
    for (const id of tombstonesById.keys()) annotationsById.delete(id);
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: normalizedIncoming.projectId || normalizedBase.projectId,
      page: {
        ...normalizedBase.page,
        ...normalizedIncoming.page,
        id: normalizedBase.page.id
      },
      annotations: [...annotationsById.values()],
      deletedAnnotations: [...tombstonesById.values()],
      managedPrd: normalizedIncoming.managedPrd ?? normalizedBase.managedPrd
    };
  }

  // prd-annotator/src/runtime/navigation.js
  function observeNavigation(window2, onRouteChange) {
    const { history } = window2;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const notify = () => onRouteChange({
      pathname: window2.location.pathname,
      hash: window2.location.hash
    });
    history.pushState = function(...args) {
      const result = originalPush.apply(this, args);
      notify();
      return result;
    };
    history.replaceState = function(...args) {
      const result = originalReplace.apply(this, args);
      notify();
      return result;
    };
    window2.addEventListener("popstate", notify);
    window2.addEventListener("hashchange", notify);
    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window2.removeEventListener("popstate", notify);
      window2.removeEventListener("hashchange", notify);
    };
  }

  // prd-annotator/src/storage.js
  function makeStorageKey(projectId, pageId) {
    return `${STORAGE_PREFIX}:${projectId}:${pageId}`;
  }
  function makeLegacyStorageKeys({
    projectId,
    pageId,
    scriptSrc,
    pathname,
    hasExplicitProjectId = false
  }) {
    const legacyProjectId = resolveLegacyProjectKey({ scriptSrc });
    const legacyPageId = resolveLegacyPageId({ pathname });
    const keys = [
      `${LEGACY_STORAGE_PREFIX}:${projectId}:${pageId}`,
      `${LEGACY_STORAGE_PREFIX}:${projectId}:${legacyPageId}`
    ];
    if (!hasExplicitProjectId) {
      keys.push(
        `${LEGACY_STORAGE_PREFIX}:${legacyProjectId}:${pageId}`,
        `${LEGACY_STORAGE_PREFIX}:${legacyProjectId}:${legacyPageId}`
      );
    }
    return [...new Set(keys)];
  }
  function createCacheStore({ storage, key, fallbackKeys = [] }) {
    let memoryRecord = null;
    let status = { mode: "storage", errorName: null };
    return Object.freeze({
      load() {
        for (const candidateKey of [key, ...fallbackKeys]) {
          try {
            const raw = storage?.getItem(candidateKey);
            if (raw) return JSON.parse(raw);
          } catch (error) {
            status = { mode: "memory", errorName: error?.name || "StorageError" };
          }
        }
        return memoryRecord ? structuredClone(memoryRecord) : null;
      },
      save(record) {
        memoryRecord = structuredClone(record);
        try {
          storage?.setItem(key, JSON.stringify(record));
          status = { mode: "storage", errorName: null };
          return { persisted: true, errorName: null };
        } catch (error) {
          status = { mode: "memory", errorName: error?.name || "StorageError" };
          return { persisted: false, errorName: status.errorName };
        }
      },
      getStatus: () => ({ ...status })
    });
  }

  // prd-annotator/src/document-scope.js
  var DOCUMENT_SCOPES = /* @__PURE__ */ new Set(["page", "global", "unassigned"]);
  var GLOBAL_ONLY_KINDS = /* @__PURE__ */ new Set(["total-prd", "public", "public-rule"]);
  function assertDocumentScope(entry) {
    if (!entry || entry.scope === void 0) throw new Error("View document requires explicit scope");
    if (!DOCUMENT_SCOPES.has(entry.scope)) throw new Error("invalid document scope");
    const pageIds = Array.isArray(entry.pageIds) ? entry.pageIds : [];
    if (entry.scope === "page" && !pageIds.length) throw new Error("page scope requires pageIds");
    if (entry.scope !== "page" && pageIds.length) throw new Error(`${entry.scope} scope requires empty pageIds`);
    if (entry.kind === "page-prd" && entry.scope === "global") throw new Error("page-prd cannot be global");
    if (GLOBAL_ONLY_KINDS.has(entry.kind) && entry.scope !== "global") {
      throw new Error(`${entry.kind} must be global`);
    }
    if (entry.kind === "unclassified" && entry.scope !== "unassigned") {
      throw new Error("unclassified must be unassigned");
    }
    return entry;
  }
  function isCurrentPageDocument(entry, pageId) {
    return entry?.scope === "page" && entry.pageIds?.includes(pageId) === true;
  }
  function hubCategoryForDocument(entry) {
    if (["total-prd", "page-prd"].includes(entry?.kind)) return "prd";
    if (entry?.kind === "field-spec") return "field";
    if (entry?.kind === "api-doc") return "api";
    return "requirement";
  }

  // prd-annotator/src/view-data.js
  var PREVIEW_STATUSES = /* @__PURE__ */ new Set(["available", "unavailable", "missing", "stale"]);
  var DISPLAY_GROUPS = /* @__PURE__ */ new Set(["page-prd", "related", "field-spec", "api-doc"]);
  var FINGERPRINT_PATTERN = /^fnv1a32:[a-f0-9]{8}$/;
  var SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function isProjectRelativePath(value) {
    return typeof value === "string" && value === value.trim() && value.length > 0 && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:[\\/]/.test(value) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.split(/[\\/]+/).includes("..");
  }
  function isRelativeViewScriptSource(value) {
    return typeof value === "string" && value === value.trim() && value.length > 0 && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:[\\/]/.test(value) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }
  function assertPage(value) {
    assert(value && typeof value === "object", "Invalid view page");
    assert(typeof value.id === "string" && /^[a-z0-9-]{1,32}$/.test(value.id), "Invalid view page.id");
    assert(typeof value.title === "string" && value.title.trim(), "Invalid view page.title");
    assert(isProjectRelativePath(value.htmlPath), "Invalid view page.htmlPath");
  }
  function assertDocumentInventory(value) {
    assert(value && typeof value === "object", "Invalid view document");
    assert(typeof value.id === "string" && value.id.trim(), "Invalid view document.id");
    assert(typeof value.title === "string" && value.title.trim(), "Invalid view document.title");
    assert(isProjectRelativePath(value.path), "View document.path must be relative");
    assert(typeof value.format === "string" && value.format.trim(), "Invalid view document.format");
    assert(typeof value.kind === "string" && value.kind.trim(), "Invalid view document.kind");
    assertDocumentScope(value);
    if (value.displayGroups !== void 0) {
      assert(
        Array.isArray(value.displayGroups) && value.displayGroups.length > 0 && new Set(value.displayGroups).size === value.displayGroups.length && value.displayGroups.every((group) => DISPLAY_GROUPS.has(group)),
        "Invalid view document.displayGroups"
      );
    }
    assert(Array.isArray(value.pageIds) && value.pageIds.every((id) => typeof id === "string" && id), "Invalid view document.pageIds");
    assert(SHA256_PATTERN.test(value.fingerprint), "Invalid view document.fingerprint");
    assert(PREVIEW_STATUSES.has(value.previewStatus), "Invalid view document.previewStatus");
    assert(typeof value.missing === "boolean", "Invalid view document.missing");
    assert(value.missing === (value.previewStatus === "missing"), "View document missing state does not match previewStatus");
    assert(typeof value.content === "string", "Invalid view document.content");
  }
  function assertValidViewDocuments(documents) {
    assert(Array.isArray(documents), "View documents must be an array");
    const ids = /* @__PURE__ */ new Set();
    for (const documentEntry of documents) {
      assertDocumentInventory(documentEntry);
      assert(!ids.has(documentEntry.id), "Duplicate document.id");
      ids.add(documentEntry.id);
    }
    return documents;
  }
  function assertValidViewBundle(value, expected = {}) {
    assert(value && typeof value === "object", "Invalid view bundle");
    assert(value.schemaVersion === SCHEMA_VERSION, "Unsupported view schemaVersion");
    assert(typeof value.generatedAt === "string" && !Number.isNaN(Date.parse(value.generatedAt)), "Invalid view generatedAt");
    assert(typeof value.projectId === "string" && value.projectId.trim(), "Invalid view projectId");
    assertPage(value.page);
    if (expected.projectId !== void 0) {
      assert(value.projectId === expected.projectId, "View projectId does not match this page");
    }
    if (expected.pageId !== void 0) {
      assert(value.page.id === expected.pageId, "View page.id does not match this page");
    }
    assert(FINGERPRINT_PATTERN.test(value.persistedAnnotationFingerprint), "Invalid persistedAnnotationFingerprint");
    assertValidDocument(value.document);
    assert(value.document.projectId === value.projectId, "View document projectId does not match bundle");
    assert(value.document.page?.id === value.page.id, "View document page.id does not match bundle");
    assert(
      fingerprintValue(annotationFingerprintInput(value.document)) === value.persistedAnnotationFingerprint,
      "persistedAnnotationFingerprint does not match annotations"
    );
    assertValidViewDocuments(value.documents);
    return value;
  }
  function loadViewScript({
    document: document2,
    src,
    loaderDataset = "prdAnnotatorViewLoader"
  }) {
    return new Promise((resolve, reject) => {
      if (!isRelativeViewScriptSource(src)) {
        reject(new Error(`PRD Annotator view source must be relative: ${src}`));
        return;
      }
      if (!["prdAnnotatorViewLoader", "prdAnnotatorRouteLoader"].includes(loaderDataset)) {
        reject(new Error(`Invalid PRD Annotator loader dataset: ${loaderDataset}`));
        return;
      }
      const script = document2.createElement("script");
      script.src = src;
      script.dataset[loaderDataset] = "true";
      script.addEventListener("load", () => {
        script.remove();
        resolve();
      }, { once: true });
      script.addEventListener("error", () => {
        script.remove();
        reject(new Error(`Unable to load PRD Annotator view: ${src}`));
      }, { once: true });
      document2.head.append(script);
    });
  }

  // prd-annotator/src/markdown-inline.js
  var INLINE_PATTERN = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\[([^\]\n]+)\]\(([^)\n]+)\)|\*([^*\n]+)\*|_([^_\n]+)_/g;
  var BROWSER_URL_BOUNDARY_WHITESPACE = /^[\0-\x20]+|[\0-\x20]+$/g;
  var ASCII_URL_CONTROLS = /[\t\r\n]/;
  var LEADING_AUTHORITY_PREFIX = /^[\\/]{2}/;
  var EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
  var ALLOWED_SCHEME = /^(?:https?:|mailto:)/i;
  function sanitizeMarkdownHref(value) {
    const href = String(value || "").replace(BROWSER_URL_BOUNDARY_WHITESPACE, "");
    if (!href || ASCII_URL_CONTROLS.test(href) || LEADING_AUTHORITY_PREFIX.test(href)) {
      return null;
    }
    if (href.startsWith("#")) return href;
    if (EXPLICIT_SCHEME.test(href)) return ALLOWED_SCHEME.test(href) ? href : null;
    return href;
  }
  function appendText(document2, parent, value) {
    if (value) parent.append(document2.createTextNode(value));
  }
  function findCodeSpan(source, startIndex) {
    for (let index = startIndex; index < source.length; index += 1) {
      if (source[index] !== "`") continue;
      let delimiterEnd = index;
      while (source[delimiterEnd] === "`") delimiterEnd += 1;
      const delimiterLength = delimiterEnd - index;
      let cursor = delimiterEnd;
      while (cursor < source.length && source[cursor] !== "\n") {
        if (source[cursor] !== "`") {
          cursor += 1;
          continue;
        }
        let candidateEnd = cursor;
        while (source[candidateEnd] === "`") candidateEnd += 1;
        if (candidateEnd - cursor === delimiterLength) {
          return {
            index,
            end: candidateEnd,
            content: source.slice(delimiterEnd, cursor)
          };
        }
        cursor = candidateEnd;
      }
      index = delimiterEnd - 1;
    }
    return null;
  }
  function findFormatting(source, startIndex) {
    INLINE_PATTERN.lastIndex = startIndex;
    return INLINE_PATTERN.exec(source);
  }
  function appendInlineMarkdown(document2, parent, source) {
    const text = String(source || "");
    let cursor = 0;
    while (cursor < text.length) {
      const codeSpan = findCodeSpan(text, cursor);
      const formatting = findFormatting(text, cursor);
      if (codeSpan && (!formatting || codeSpan.index <= formatting.index)) {
        appendText(document2, parent, text.slice(cursor, codeSpan.index));
        const code = document2.createElement("code");
        code.className = "markdown-inline-code";
        code.textContent = codeSpan.content;
        parent.append(code);
        cursor = codeSpan.end;
        continue;
      }
      if (!formatting) break;
      appendText(document2, parent, text.slice(cursor, formatting.index));
      const [
        token,
        starStrong,
        underscoreStrong,
        linkLabel,
        linkHref,
        starEmphasis,
        underscoreEmphasis
      ] = formatting;
      if (starStrong !== void 0 || underscoreStrong !== void 0) {
        const strong = document2.createElement("strong");
        appendInlineMarkdown(document2, strong, starStrong ?? underscoreStrong);
        parent.append(strong);
      } else if (linkLabel !== void 0) {
        const href = sanitizeMarkdownHref(linkHref);
        if (!href) {
          appendInlineMarkdown(document2, parent, linkLabel);
        } else {
          const link = document2.createElement("a");
          link.setAttribute("href", href);
          if (/^https?:/i.test(href)) {
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
          appendInlineMarkdown(document2, link, linkLabel);
          parent.append(link);
        }
      } else {
        const emphasis = document2.createElement("em");
        appendInlineMarkdown(document2, emphasis, starEmphasis ?? underscoreEmphasis);
        parent.append(emphasis);
      }
      cursor = formatting.index + token.length;
    }
    appendText(document2, parent, text.slice(cursor));
  }

  // prd-annotator/src/markdown-table.js
  var DELIMITER_CELL = /^:?-{3,}:?$/;
  function splitTableRow(line) {
    const source = String(line || "").trim();
    const codeSpanEnds = findCodeSpanEnds(source);
    const cells = [];
    let cell = "";
    let firstSeparator = -1;
    let lastSeparator = -1;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (codeSpanEnds.has(index)) {
        cell += character;
      } else if (character === "\\") {
        let runEnd = index;
        while (source[runEnd] === "\\") runEnd += 1;
        const count = runEnd - index;
        if (source[runEnd] === "|") {
          cell += "\\".repeat(Math.floor(count / 2));
          if (count % 2) cell += "|";
          else {
            if (firstSeparator === -1) firstSeparator = index;
            lastSeparator = runEnd;
            cells.push(cell.trim());
            cell = "";
          }
          index = runEnd;
        } else {
          cell += source.slice(index, runEnd);
          index = runEnd - 1;
        }
      } else if (character === "|" && !codeSpanEnds.has(index)) {
        if (firstSeparator === -1) firstSeparator = index;
        lastSeparator = index;
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += character;
      }
    }
    cells.push(cell.trim());
    if (firstSeparator === 0) cells.shift();
    if (lastSeparator === source.length - 1) cells.pop();
    return cells;
  }
  function findCodeSpanEnds(source) {
    const protectedIndexes = /* @__PURE__ */ new Set();
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== "`") continue;
      let delimiterEnd = index;
      while (source[delimiterEnd] === "`") delimiterEnd += 1;
      const delimiterLength = delimiterEnd - index;
      let cursor = delimiterEnd;
      let closingStart = -1;
      while (cursor < source.length) {
        if (source[cursor] !== "`") {
          cursor += 1;
          continue;
        }
        let candidateEnd = cursor;
        while (source[candidateEnd] === "`") candidateEnd += 1;
        if (candidateEnd - cursor === delimiterLength) {
          closingStart = cursor;
          break;
        }
        cursor = candidateEnd;
      }
      if (closingStart === -1) {
        index = delimiterEnd - 1;
        continue;
      }
      for (let protectedIndex = index; protectedIndex < closingStart + delimiterLength; protectedIndex += 1) {
        protectedIndexes.add(protectedIndex);
      }
      index = closingStart + delimiterLength - 1;
    }
    return protectedIndexes;
  }
  function alignmentFor(delimiter) {
    const left = delimiter.startsWith(":");
    const right = delimiter.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  }
  function parseMarkdownTable(lines, startIndex) {
    if (startIndex + 1 >= lines.length || !lines[startIndex].includes("|")) return null;
    const headers = splitTableRow(lines[startIndex]);
    const delimiters = splitTableRow(lines[startIndex + 1]);
    if (headers.length < 2 || delimiters.length !== headers.length || delimiters.some((cell) => !DELIMITER_CELL.test(cell))) return null;
    const rows = [];
    let nextIndex = startIndex + 2;
    while (nextIndex < lines.length && lines[nextIndex].trim()) {
      if (!lines[nextIndex].includes("|")) break;
      const cells = splitTableRow(lines[nextIndex]);
      if (cells.length !== headers.length) break;
      rows.push(cells);
      nextIndex += 1;
    }
    return {
      headers,
      alignments: delimiters.map(alignmentFor),
      rows,
      nextIndex
    };
  }
  function appendCell(document2, row, tagName, value, alignment) {
    const cell = document2.createElement(tagName);
    cell.dataset.align = alignment;
    if (tagName === "th") cell.scope = "col";
    appendInlineMarkdown(document2, cell, value);
    row.append(cell);
  }
  function renderMarkdownTable(document2, table) {
    const wrapper = document2.createElement("div");
    wrapper.className = "markdown-table-scroll";
    const element = document2.createElement("table");
    element.className = table.rows.length ? "markdown-table" : "markdown-table markdown-table--empty";
    const head = document2.createElement("thead");
    const headRow = document2.createElement("tr");
    table.headers.forEach((header, index) => {
      appendCell(document2, headRow, "th", header, table.alignments[index]);
    });
    head.append(headRow);
    const body = document2.createElement("tbody");
    for (const sourceRow of table.rows) {
      const row = document2.createElement("tr");
      sourceRow.forEach((value, index) => {
        appendCell(document2, row, "td", value, table.alignments[index]);
      });
      body.append(row);
    }
    element.append(head, body);
    wrapper.append(element);
    return wrapper;
  }

  // prd-annotator/src/markdown.js
  var HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
  var UNORDERED_PATTERN = /^\s*[-+*]\s+(.+)$/;
  var ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
  var QUOTE_PATTERN = /^\s*>\s?(.*)$/;
  var RULE_PATTERN = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var FENCE_PATTERN = /^\s*```([^`]*)$/;
  function isBlockStart(line) {
    return HEADING_PATTERN.test(line) || UNORDERED_PATTERN.test(line) || ORDERED_PATTERN.test(line) || QUOTE_PATTERN.test(line) || RULE_PATTERN.test(line) || FENCE_PATTERN.test(line);
  }
  function renderMarkdown(document2, markdown) {
    const fragment = document2.createDocumentFragment();
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; ) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      const table = parseMarkdownTable(lines, index);
      if (table) {
        fragment.append(renderMarkdownTable(document2, table));
        index = table.nextIndex;
        continue;
      }
      const fence = line.match(FENCE_PATTERN);
      if (fence) {
        const codeLines = [];
        index += 1;
        while (index < lines.length && !FENCE_PATTERN.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        const pre = document2.createElement("pre");
        const code = document2.createElement("code");
        const language = fence[1].trim().replace(/[^a-zA-Z0-9_-]/g, "");
        if (language) code.dataset.language = language;
        code.textContent = codeLines.join("\n");
        pre.append(code);
        fragment.append(pre);
        continue;
      }
      const heading = line.match(HEADING_PATTERN);
      if (heading) {
        const node = document2.createElement(`h${heading[1].length}`);
        appendInlineMarkdown(document2, node, heading[2].trim());
        fragment.append(node);
        index += 1;
        continue;
      }
      if (RULE_PATTERN.test(line)) {
        fragment.append(document2.createElement("hr"));
        index += 1;
        continue;
      }
      const listPattern = UNORDERED_PATTERN.test(line) ? UNORDERED_PATTERN : ORDERED_PATTERN.test(line) ? ORDERED_PATTERN : null;
      if (listPattern) {
        const list = document2.createElement(
          listPattern === ORDERED_PATTERN ? "ol" : "ul"
        );
        while (index < lines.length) {
          const itemMatch = lines[index].match(listPattern);
          if (!itemMatch) break;
          const item = document2.createElement("li");
          appendInlineMarkdown(document2, item, itemMatch[1].trim());
          list.append(item);
          index += 1;
        }
        fragment.append(list);
        continue;
      }
      if (QUOTE_PATTERN.test(line)) {
        const quoteLines = [];
        while (index < lines.length) {
          const quote = lines[index].match(QUOTE_PATTERN);
          if (!quote) break;
          quoteLines.push(quote[1]);
          index += 1;
        }
        const blockquote = document2.createElement("blockquote");
        appendInlineMarkdown(document2, blockquote, quoteLines.join("\n"));
        fragment.append(blockquote);
        continue;
      }
      const paragraphLines = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index]) && !parseMarkdownTable(lines, index)) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      const paragraph = document2.createElement("p");
      appendInlineMarkdown(document2, paragraph, paragraphLines.join(" "));
      fragment.append(paragraph);
    }
    return fragment;
  }

  // prd-annotator/src/ui/drawer.js
  function appendAnnotationSection(container, { id, label, value }) {
    if (!String(value || "").trim()) return null;
    const section = container.ownerDocument.createElement("section");
    section.className = "annotation-section";
    section.dataset.section = id;
    const heading = container.ownerDocument.createElement("h5");
    heading.className = "annotation-section-label";
    heading.textContent = label;
    const content = container.ownerDocument.createElement("p");
    content.className = "annotation-section-content";
    content.textContent = value;
    section.append(heading, content);
    container.append(section);
    return section;
  }
  function renderAnnotationList(container, annotationDocument, { onEdit = () => {
  }, onDelete = () => {
  } } = {}) {
    container.replaceChildren();
    container.tabIndex = -1;
    if (!annotationDocument.annotations.length) {
      const empty = container.ownerDocument.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "本页还没有标注";
      container.append(empty);
      return;
    }
    const list = container.ownerDocument.createElement("ol");
    list.className = "annotation-list";
    annotationDocument.annotations.forEach((annotation, index) => {
      const item = container.ownerDocument.createElement("li");
      item.className = "annotation-card";
      item.dataset.annotationId = annotation.id;
      const header = container.ownerDocument.createElement("header");
      header.className = "annotation-card-header";
      const number = container.ownerDocument.createElement("span");
      number.className = "annotation-number";
      number.textContent = annotationDisplayNumber(annotation, index);
      const heading = container.ownerDocument.createElement("div");
      heading.className = "annotation-heading";
      const title = container.ownerDocument.createElement("h4");
      title.className = "annotation-title";
      title.textContent = annotation.title;
      const type = container.ownerDocument.createElement("span");
      type.className = "annotation-type";
      type.textContent = annotation.type;
      const metadata = container.ownerDocument.createElement("div");
      metadata.className = "annotation-metadata";
      const status = container.ownerDocument.createElement("span");
      status.className = `status status-${annotation.status}`;
      status.textContent = annotation.status;
      metadata.append(type, status);
      heading.append(title, metadata);
      const actions = container.ownerDocument.createElement("div");
      actions.className = "annotation-actions";
      const edit = container.ownerDocument.createElement("button");
      edit.type = "button";
      edit.className = "secondary-button annotation-action";
      edit.dataset.action = "edit-annotation";
      edit.dataset.annotationId = annotation.id;
      edit.setAttribute(
        "aria-label",
        `编辑标注 ${number.textContent}：${annotation.title}`
      );
      edit.textContent = "编辑";
      edit.addEventListener("click", () => onEdit(annotation.id));
      const remove = container.ownerDocument.createElement("button");
      remove.type = "button";
      remove.className = "secondary-button annotation-action annotation-delete";
      remove.dataset.action = "delete-annotation";
      remove.dataset.annotationId = annotation.id;
      remove.setAttribute(
        "aria-label",
        `删除标注 ${number.textContent}：${annotation.title}`
      );
      remove.textContent = "删除";
      remove.addEventListener("click", () => onDelete(annotation.id));
      actions.append(edit, remove);
      header.append(number, heading, actions);
      const sections = container.ownerDocument.createElement("div");
      sections.className = "annotation-sections";
      appendAnnotationSection(sections, {
        id: "description",
        label: "说明",
        value: annotation.description
      });
      appendAnnotationSection(sections, {
        id: "prd-content",
        label: "PRD 内容",
        value: annotation.prdContent
      });
      appendAnnotationSection(sections, {
        id: "note",
        label: "备注",
        value: annotation.note
      });
      if (annotation.prd.linkedSections?.length) {
        const linked = container.ownerDocument.createElement("section");
        linked.className = "annotation-section";
        linked.dataset.section = "linked-sections";
        const linkedLabel = container.ownerDocument.createElement("h5");
        linkedLabel.className = "annotation-section-label";
        linkedLabel.textContent = "关联章节";
        const linkedList = container.ownerDocument.createElement("ul");
        linkedList.className = "linked-sections";
        for (const sectionName of annotation.prd.linkedSections) {
          const linkedItem = container.ownerDocument.createElement("li");
          linkedItem.textContent = sectionName;
          linkedList.append(linkedItem);
        }
        linked.append(linkedLabel, linkedList);
        sections.append(linked);
      }
      item.append(header, sections);
      list.append(item);
    });
    container.append(list);
  }
  function renderPagePrd(container, markdown) {
    container.replaceChildren();
    if (!String(markdown || "").trim()) {
      const empty = container.ownerDocument.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "页面 PRD 尚未生成";
      container.append(empty);
      return;
    }
    container.append(renderMarkdown(container.ownerDocument, markdown));
  }
  function appendTextElement(container, tagName, className, text) {
    const element = container.ownerDocument.createElement(tagName);
    element.className = className;
    element.textContent = text;
    container.append(element);
    return element;
  }
  function previewLabel(status) {
    return {
      available: "可预览",
      unavailable: "暂不可预览",
      missing: "源文件缺失",
      stale: "内容可能已过期"
    }[status] || status;
  }
  function appendDocumentCard(container, documentEntry) {
    const card = container.ownerDocument.createElement("article");
    card.className = "document-card";
    card.dataset.documentId = documentEntry.id;
    appendTextElement(card, "h4", "document-title", documentEntry.title);
    appendTextElement(card, "p", "document-path", `来源：${documentEntry.path}`);
    const metadata = container.ownerDocument.createElement("div");
    metadata.className = "document-metadata";
    appendTextElement(metadata, "span", "document-format", `格式：${documentEntry.format}`);
    appendTextElement(metadata, "span", "document-kind", `类型：${documentEntry.kind}`);
    appendTextElement(metadata, "span", "document-preview-status", `预览：${previewLabel(documentEntry.previewStatus)}`);
    card.append(metadata);
    if (documentEntry.previewStatus === "stale") {
      appendTextElement(card, "p", "document-warning", "内容可能已过期，请让 AI Agent 重新生成展示数据。");
    }
    if (documentEntry.previewStatus === "missing") {
      appendTextElement(card, "p", "document-warning", "源文件缺失，需要 AI Agent 重新生成展示数据。");
    }
    if (documentEntry.content.trim()) {
      const content = container.ownerDocument.createElement("div");
      content.className = "document-content";
      content.append(renderMarkdown(container.ownerDocument, documentEntry.content));
      card.append(content);
    }
    container.append(card);
  }
  function renderViewWarning(container, error) {
    container.replaceChildren();
    if (!error) return;
    appendTextElement(container, "p", "view-warning", "需要 AI Agent 重新生成本页展示数据。浏览器中的标注将继续保留。");
  }
  function renderSyncState(container, state) {
    container.replaceChildren();
    container.dataset.state = state;
    const message = {
      synced: "已同步到项目",
      "browser-only": "当前标注仅保存在此浏览器，尚未同步到项目",
      "memory-only": "浏览器存储不可用。关闭页面前必须复制提示词并让 AI 同步"
    }[state];
    appendTextElement(container, "p", "sync-state-message", message);
  }
  function renderSyncHelp(container, {
    prompt,
    copyResult = "",
    showFallback = false,
    onCopy
  }) {
    container.replaceChildren();
    const heading = appendTextElement(container, "h3", "sync-help-heading", "同步到项目");
    heading.id = "prd-sync-help-heading";
    container.setAttribute("aria-labelledby", heading.id);
    const instructions = container.ownerDocument.createElement("ol");
    instructions.className = "sync-instructions";
    ["复制", "返回 AI Agent", "粘贴并发送", "等待文件写入报告", "刷新原型，确认 AI Agent 已重新生成 view bundle"].forEach((instruction) => {
      appendTextElement(instructions, "li", "sync-instruction", instruction);
    });
    container.append(instructions);
    const copyButton = container.ownerDocument.createElement("button");
    copyButton.type = "button";
    copyButton.className = "secondary-button sync-copy-button";
    copyButton.dataset.action = "copy-sync-prompt";
    copyButton.textContent = "复制同步提示词";
    copyButton.addEventListener("click", onCopy);
    container.append(copyButton);
    const result = appendTextElement(container, "p", "copy-result", copyResult);
    result.dataset.role = "copy-result";
    result.setAttribute("aria-live", "polite");
    if (!showFallback) return;
    const fallbackLabel = appendTextElement(
      container,
      "p",
      "sync-fallback-label",
      "无法访问剪贴板。请手动选择并复制以下提示词："
    );
    const fallback = container.ownerDocument.createElement("textarea");
    fallback.className = "sync-prompt-fallback";
    fallback.dataset.role = "sync-prompt-fallback";
    fallback.readOnly = true;
    fallback.value = prompt;
    fallback.setAttribute("aria-label", fallbackLabel.textContent);
    container.append(fallback);
  }
  function renderPageMetadata(container, page, generatedAt) {
    container.replaceChildren();
    appendTextElement(container, "p", "page-metadata-path", page.htmlPath);
    if (generatedAt) appendTextElement(container, "p", "page-metadata-generated", `展示数据生成于：${generatedAt}`);
  }

  // prd-annotator/src/ui/page-documents.js
  function renderCollection(container, documents, emptyText) {
    container.replaceChildren();
    for (const entry of documents) appendDocumentCard(container, entry);
    if (container.childElementCount) return;
    const empty = container.ownerDocument.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.append(empty);
  }
  function createPageDocumentController({
    root,
    prdContainer,
    pagePrdContainer,
    supplementContainer,
    fieldContainer,
    apiContainer
  } = {}) {
    const buttons = [...root.querySelectorAll("[data-page-doc-view]")];
    const panels = [...root.querySelectorAll("[data-page-doc-panel]")];
    const count = root.querySelector("[data-role='supplement-count']");
    let selectedId = "prd";
    function select(id) {
      if (!buttons.some((button) => button.dataset.pageDocView === id)) {
        throw new Error(`Unknown page document view: ${id}`);
      }
      selectedId = id;
      for (const button of buttons) {
        const active = button.dataset.pageDocView === id;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      for (const panel of panels) panel.hidden = panel.dataset.pageDocPanel !== id;
    }
    for (const button of buttons) {
      button.addEventListener("click", () => select(button.dataset.pageDocView));
    }
    function render({ documents, pageId, managedMarkdown } = {}) {
      const current = (documents || []).filter((entry) => isCurrentPageDocument(entry, pageId));
      const pagePrds = current.filter((entry) => entry.kind === "page-prd");
      const fields = current.filter((entry) => entry.kind === "field-spec");
      const apis = current.filter((entry) => entry.kind === "api-doc");
      const supplements = current.filter((entry) => !["page-prd", "field-spec", "api-doc"].includes(entry.kind));
      count.textContent = String(supplements.length);
      renderCollection(pagePrdContainer, pagePrds, "本页尚无关联的页面 PRD 文档。请明确请求 AI Agent 生成或关联。");
      renderCollection(supplementContainer, supplements, "本页尚无补充资料。请明确请求 AI Agent 生成或关联。");
      renderCollection(fieldContainer, fields, "本页尚无页面字段规范。请明确请求 AI Agent 生成或关联。");
      renderCollection(apiContainer, apis, "本页尚无页面接口文档。请明确请求 AI Agent 生成或关联。");
      if (typeof managedMarkdown !== "string") prdContainer.replaceChildren();
      select(selectedId);
    }
    function reset() {
      select("prd");
    }
    reset();
    return { render, select, reset };
  }

  // prd-annotator/src/ui/document-hub.js
  var HUB_CATEGORIES = Object.freeze([
    { id: "requirement", label: "总需求文档" },
    { id: "prd", label: "总 PRD 文档" },
    { id: "field", label: "总字段规范" },
    { id: "api", label: "总接口文档" }
  ]);
  function appendEmpty(container, text) {
    const empty = container.ownerDocument.createElement("p");
    empty.className = "empty-state";
    empty.textContent = text;
    container.append(empty);
  }
  function appendDocuments(container, documents, emptyText) {
    container.replaceChildren();
    for (const entry of documents) appendDocumentCard(container, entry);
    if (!container.childElementCount) appendEmpty(container, emptyText);
  }
  function createDocumentHub({ root } = {}) {
    const entriesView = root.querySelector("[data-hub-view='entries']");
    const detailView = root.querySelector("[data-hub-view='detail']");
    const title = root.querySelector("[data-role='hub-detail-title']");
    const globalDocuments = root.querySelector("[data-role='hub-global-documents']");
    const candidateDocuments = root.querySelector("[data-role='hub-candidate-documents']");
    const back = root.querySelector("[data-action='back-to-document-hub']");
    let documents = [];
    function categoryDocuments(categoryId, scope) {
      return documents.filter((entry) => entry.scope === scope && hubCategoryForDocument(entry) === categoryId);
    }
    function renderEntries() {
      entriesView.replaceChildren();
      for (const category of HUB_CATEGORIES) {
        const button = entriesView.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "document-hub-card";
        button.dataset.hubCategory = category.id;
        const heading = entriesView.ownerDocument.createElement("strong");
        heading.textContent = category.label;
        const counts = entriesView.ownerDocument.createElement("span");
        counts.className = "document-hub-counts";
        counts.textContent = `全局文档 ${categoryDocuments(category.id, "global").length} · 待关联候选 ${categoryDocuments(category.id, "unassigned").length}`;
        button.append(heading, counts);
        button.addEventListener("click", () => open(category.id));
        entriesView.append(button);
      }
    }
    function open(categoryId) {
      const category = HUB_CATEGORIES.find((entry) => entry.id === categoryId);
      if (!category) throw new Error(`Unknown document hub category: ${categoryId}`);
      title.textContent = category.label;
      appendDocuments(globalDocuments, categoryDocuments(categoryId, "global"), "暂无全局文档");
      appendDocuments(candidateDocuments, categoryDocuments(categoryId, "unassigned"), "暂无待关联候选");
      entriesView.hidden = true;
      detailView.hidden = false;
    }
    function reset() {
      detailView.hidden = true;
      entriesView.hidden = false;
    }
    function render(nextDocuments = []) {
      documents = nextDocuments.filter((entry) => ["global", "unassigned"].includes(entry.scope));
      renderEntries();
      reset();
    }
    back.addEventListener("click", reset);
    return { render, open, reset };
  }

  // prd-annotator/src/ui/delete-dialog.js
  function openDeleteDialog({
    container,
    annotation,
    displayNumber,
    onConfirm,
    onCancel
  }) {
    const document2 = container.ownerDocument;
    const heading = document2.createElement("h2");
    heading.id = "prd-delete-dialog-heading";
    heading.textContent = `删除标注 ${displayNumber}？`;
    const description = document2.createElement("p");
    description.id = "prd-delete-dialog-description";
    description.className = "delete-dialog-description";
    description.textContent = [
      `“${annotation.title}”会立即从本页消失。`,
      "请通知 AI Agent 同步标注后更新项目文件。",
      "不会自动修改 PRD 或其他项目文档。"
    ].join("");
    const actions = document2.createElement("div");
    actions.className = "delete-dialog-actions";
    const cancel = document2.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.dataset.action = "cancel-delete";
    cancel.textContent = "取消";
    const confirm = document2.createElement("button");
    confirm.type = "button";
    confirm.className = "confirm-delete";
    confirm.dataset.action = "confirm-delete";
    confirm.textContent = "确认删除";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const activeElement = container.getRootNode().activeElement;
      if (event.shiftKey && activeElement === cancel) {
        event.preventDefault();
        confirm.focus();
      } else if (!event.shiftKey && activeElement === confirm) {
        event.preventDefault();
        cancel.focus();
      }
    };
    cancel.addEventListener("click", () => onCancel());
    confirm.addEventListener("click", () => onConfirm());
    cancel.addEventListener("keydown", handleKeyDown);
    confirm.addEventListener("keydown", handleKeyDown);
    actions.append(cancel, confirm);
    const surface = document2.createElement("div");
    surface.className = "delete-dialog";
    surface.append(heading, description, actions);
    container.replaceChildren(surface);
    container.dataset.dialog = "delete-confirmation";
    container.removeAttribute("aria-label");
    container.setAttribute("aria-labelledby", heading.id);
    container.setAttribute("aria-describedby", description.id);
    container.hidden = false;
    cancel.focus();
  }

  // prd-annotator/src/ui/editor.js
  function targetLabel(target) {
    return target.textQuote || target.cssPath || "所选页面区域";
  }
  function closeEditor(container) {
    container.hidden = true;
    container.replaceChildren();
    container.removeAttribute("aria-labelledby");
    container.removeAttribute("aria-describedby");
    container.removeAttribute("data-dialog");
  }
  function openEditor({
    container,
    target,
    initialValue = null,
    onSave,
    onCancel
  }) {
    const document2 = container.ownerDocument;
    const isEditing = Boolean(initialValue);
    const fields = [
      { name: "title", label: "标题", required: true, control: "input" },
      { name: "description", label: "说明", required: true, control: "textarea" },
      { name: "type", label: "类型", required: true, control: "select" },
      { name: "prdContent", label: "PRD 内容", required: true, control: "textarea" },
      { name: "note", label: "备注", control: "textarea" }
    ];
    const typeLabels = {
      requirement: "需求",
      change: "变更",
      question: "问题",
      bug: "缺陷"
    };
    const heading = document2.createElement("h2");
    heading.id = "prd-annotation-editor-heading";
    heading.textContent = isEditing ? "编辑本页标注" : "添加本页标注";
    const targetText = document2.createElement("p");
    targetText.className = "selected-target";
    targetText.textContent = targetLabel(target);
    const fieldControls = /* @__PURE__ */ new Map();
    const fieldErrors = /* @__PURE__ */ new Map();
    const form = document2.createElement("div");
    form.className = "editor-form";
    for (const field of fields) {
      const fieldGroup = document2.createElement("div");
      fieldGroup.className = "editor-field";
      const label = document2.createElement("label");
      label.htmlFor = `prd-annotation-${field.name}`;
      label.textContent = `${field.label}${field.required ? " *" : ""}`;
      const control = document2.createElement(field.control);
      control.id = `prd-annotation-${field.name}`;
      control.dataset.field = field.name;
      control.required = Boolean(field.required);
      if (field.control === "textarea") control.rows = field.name === "prdContent" ? 5 : 3;
      if (field.control === "select") {
        for (const type of ANNOTATION_TYPES) {
          const option = document2.createElement("option");
          option.value = type;
          option.textContent = typeLabels[type];
          control.append(option);
        }
      }
      const initialFieldValue = initialValue?.[field.name];
      if (initialFieldValue !== void 0) control.value = String(initialFieldValue);
      const error = document2.createElement("p");
      error.className = "field-error";
      error.dataset.errorFor = field.name;
      error.hidden = true;
      error.textContent = `请填写${field.label}`;
      fieldControls.set(field.name, control);
      fieldErrors.set(field.name, error);
      fieldGroup.append(label, control, error);
      form.append(fieldGroup);
    }
    const actions = document2.createElement("div");
    actions.className = "editor-actions";
    const cancelButton = document2.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "secondary-button";
    cancelButton.dataset.action = "cancel-annotation";
    cancelButton.textContent = "取消";
    const saveButton = document2.createElement("button");
    saveButton.type = "button";
    saveButton.dataset.action = "save-annotation";
    saveButton.textContent = isEditing ? "保存修改" : "保存标注";
    cancelButton.addEventListener("click", () => onCancel());
    saveButton.addEventListener("click", () => {
      const formValue = Object.fromEntries(
        fields.map(({ name }) => [name, fieldControls.get(name).value.trim()])
      );
      let firstInvalidControl = null;
      for (const field of fields.filter(({ required }) => required)) {
        const control = fieldControls.get(field.name);
        const error = fieldErrors.get(field.name);
        const isInvalid = !formValue[field.name];
        control.toggleAttribute("aria-invalid", isInvalid);
        error.hidden = !isInvalid;
        if (isInvalid && !firstInvalidControl) firstInvalidControl = control;
      }
      if (firstInvalidControl) {
        firstInvalidControl.focus();
        return;
      }
      onSave(formValue);
    });
    actions.append(cancelButton, saveButton);
    container.replaceChildren(heading, targetText, form, actions);
    container.dataset.dialog = "annotation-editor";
    container.removeAttribute("aria-label");
    container.setAttribute("aria-labelledby", heading.id);
    container.removeAttribute("aria-describedby");
    container.hidden = false;
    fieldControls.get("title").focus();
  }

  // prd-annotator/src/ui/overlay.js
  function positionBox(node, rect) {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }
  function createOverlayController({ document: document2, container }) {
    const window2 = document2.defaultView;
    const requestFrame = typeof window2.requestAnimationFrame === "function" ? window2.requestAnimationFrame.bind(window2) : (callback) => window2.setTimeout(callback, 16);
    const cancelFrame = typeof window2.cancelAnimationFrame === "function" ? window2.cancelAnimationFrame.bind(window2) : (handle) => window2.clearTimeout(handle);
    const hover = document2.createElement("div");
    hover.className = "hover-outline";
    hover.hidden = true;
    container.append(hover);
    let markerNodes = [];
    let currentAnnotations = [];
    let refreshHandle = null;
    let destroyed = false;
    function showHover(element) {
      if (!isAnnotatable(element)) {
        hideHover();
        return;
      }
      positionBox(hover, element.getBoundingClientRect());
      hover.hidden = false;
    }
    function hideHover() {
      hover.hidden = true;
    }
    function renderMarkers(annotations) {
      currentAnnotations = annotations;
      for (const marker of markerNodes) marker.remove();
      markerNodes = [];
      annotations.forEach((annotation, index) => {
        const target = resolveTarget(document2, annotation.target);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const marker = document2.createElement("span");
        marker.className = "annotation-marker";
        marker.dataset.annotationId = annotation.id;
        marker.dataset.status = annotation.status;
        marker.textContent = annotationDisplayNumber(annotation, index);
        marker.style.left = `${rect.right}px`;
        marker.style.top = `${rect.top}px`;
        marker.setAttribute("aria-hidden", "true");
        container.append(marker);
        markerNodes.push(marker);
      });
    }
    const refresh = () => {
      refreshHandle = null;
      if (!destroyed) renderMarkers(currentAnnotations);
    };
    const scheduleRefresh = () => {
      if (destroyed || refreshHandle !== null) return;
      refreshHandle = requestFrame(refresh);
    };
    document2.addEventListener("scroll", scheduleRefresh, true);
    window2.addEventListener("resize", scheduleRefresh);
    const observer = new window2.MutationObserver(scheduleRefresh);
    if (document2.body) {
      observer.observe(document2.body, {
        attributes: true,
        childList: true,
        subtree: true
      });
    }
    function destroy() {
      destroyed = true;
      document2.removeEventListener("scroll", scheduleRefresh, true);
      window2.removeEventListener("resize", scheduleRefresh);
      observer.disconnect();
      if (refreshHandle !== null) cancelFrame(refreshHandle);
      refreshHandle = null;
      currentAnnotations = [];
      markerNodes = [];
      container.replaceChildren();
    }
    return Object.freeze({
      showHover,
      hideHover,
      renderMarkers,
      destroy
    });
  }

  // prd-annotator/src/ui/styles.js
  var styles = `
  :host {
    all: initial;
    --prd-color-surface: #ffffff;
    --prd-color-surface-strong: #17212b;
    --prd-color-text: #17212b;
    --prd-color-text-inverse: #ffffff;
    --prd-color-border: #d5dde5;
    --prd-color-focus: #f59e0b;
    --prd-color-danger: #b91c1c;
    --prd-space-2: 8px;
    --prd-space-3: 12px;
    --prd-radius: 8px;
    --prd-shadow: 0 14px 36px rgb(15 23 42 / 22%);
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    pointer-events: none;
    color: var(--prd-color-text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  .overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .hover-outline {
    position: fixed;
    border: 2px dashed #d97706;
    background: rgb(245 158 11 / 10%);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 85%);
    pointer-events: none;
  }

  .annotation-marker {
    position: fixed;
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 2px solid #ffffff;
    border-radius: 50%;
    background: #d97706;
    box-shadow: 0 3px 10px rgb(15 23 42 / 28%);
    color: #ffffff;
    font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .annotation-marker[data-status="applied"] {
    background: #16835b;
  }

  .annotation-marker[data-status="needs-clarification"] {
    background: #c2410c;
  }

  .annotation-marker[data-status="superseded"] {
    background: #64748b;
  }

  .tools {
    position: fixed;
    right: 20px;
    bottom: 20px;
    display: flex;
    align-items: stretch;
    pointer-events: auto;
    transition: right 120ms ease, bottom 120ms ease;
  }

  .tool-actions {
    display: flex;
    gap: var(--prd-space-2);
  }

  .tools[data-collapsed="true"] {
    right: 0;
  }

  button {
    min-height: 44px;
    border: 1px solid var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 9px 14px;
    background: var(--prd-color-surface-strong);
    box-shadow: var(--prd-shadow);
    color: var(--prd-color-text-inverse);
    font: 600 14px/1.25 ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }

  button:hover {
    background: #263647;
  }

  button:active,
  button[aria-pressed="true"],
  button[aria-expanded="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  button:focus-visible {
    outline: 3px solid var(--prd-color-focus);
    outline-offset: 3px;
  }

  button.tool-launcher-toggle {
    display: grid;
    width: 32px;
    min-width: 32px;
    height: 44px;
    min-height: 44px;
    place-items: center;
    margin-left: var(--prd-space-2);
    border-color: var(--prd-color-surface-strong);
    border-radius: var(--prd-radius);
    padding: 0;
    background: var(--prd-color-surface-strong);
    color: var(--prd-color-text-inverse);
    transition: background-color 120ms ease;
  }

  button.tool-launcher-toggle:hover {
    background: #263647;
  }

  .tool-launcher-chevron {
    display: block;
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle {
    width: 24px;
    min-width: 24px;
    margin-left: 0;
    border-right: 0;
    border-radius: 22px 0 0 22px;
  }

  .tools[data-collapsed="true"] .tool-launcher-chevron {
    transform: rotate(180deg);
  }

  .tools[data-collapsed="true"]
    button.tool-launcher-toggle[data-annotation-active="true"] {
    border-color: #d97706;
    background: #b45309;
  }

  .tools[data-collapsed="true"] button.tool-launcher-toggle:focus-visible {
    outline-offset: -4px;
  }

  .editor,
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    width: min(480px, 100%);
    height: 100dvh;
    border-left: 1px solid var(--prd-color-border);
    background: var(--prd-color-surface);
    box-shadow: var(--prd-shadow);
    pointer-events: auto;
    overflow: auto;
  }

  .editor {
    inset: 50% auto auto 50%;
    width: min(440px, calc(100vw - 32px));
    height: auto;
    max-height: calc(100dvh - 32px);
    border: 1px solid var(--prd-color-border);
    border-radius: 10px;
    transform: translate(-50%, -50%);
    padding: 24px;
  }

  .editor h2,
  .drawer h2,
  .drawer h3,
  .editor p,
  .drawer p {
    margin: 0;
  }

  .editor h2 {
    font-size: 18px;
    line-height: 1.3;
  }

  .selected-target {
    margin-top: 8px !important;
    margin-bottom: 20px !important;
    padding-left: 10px;
    border-left: 3px solid #d97706;
    color: #475569;
    overflow-wrap: anywhere;
  }

  .editor-form {
    display: grid;
    gap: 14px;
  }

  .editor-field {
    min-width: 0;
  }

  .editor label {
    display: block;
    margin-bottom: 6px;
    font-weight: 700;
  }

  .editor input,
  .editor select,
  .editor textarea {
    display: block;
    width: 100%;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px 12px;
    color: var(--prd-color-text);
    background: #ffffff;
    font: 400 14px/1.55 ui-sans-serif, system-ui, sans-serif;
  }

  .editor textarea {
    min-height: 84px;
    resize: vertical;
  }

  .editor [data-field="prdContent"] {
    min-height: 132px;
  }

  .editor input:focus-visible,
  .editor select:focus-visible,
  .editor textarea:focus-visible {
    border-color: #b45309;
    outline: 3px solid rgb(245 158 11 / 35%);
    outline-offset: 1px;
  }

  .editor input[aria-invalid="true"],
  .editor select[aria-invalid="true"],
  .editor textarea[aria-invalid="true"] {
    border-color: #b91c1c;
  }

  .field-error {
    margin-top: 6px !important;
    color: #b91c1c;
    font-size: 12px;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--prd-space-2);
    margin-top: 20px;
  }

  .delete-dialog {
    width: 100%;
    max-width: 100%;
  }

  .delete-dialog-description {
    margin-top: 12px !important;
    color: #475569;
    overflow-wrap: anywhere;
  }

  .delete-dialog-actions {
    display: flex;
    max-width: 100%;
    justify-content: flex-end;
    gap: var(--prd-space-2);
    margin-top: 20px;
  }

  button.confirm-delete {
    border-color: var(--prd-color-danger);
    background: var(--prd-color-danger);
  }

  button.confirm-delete:hover {
    background: #991b1b;
  }

  button.secondary-button,
  button.drawer-close {
    border-color: var(--prd-color-border);
    background: #ffffff;
    box-shadow: none;
    color: var(--prd-color-text);
  }

  button.secondary-button:hover,
  button.drawer-close:hover {
    background: #f1f5f9;
  }

  .drawer-header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 84px;
    border-bottom: 1px solid var(--prd-color-border);
    padding: 16px 20px;
    background: rgb(255 255 255 / 96%);
  }

  .eyebrow {
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .drawer h2 {
    margin-top: 2px;
    font-size: 18px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  button.drawer-close {
    min-width: 44px;
    padding: 8px;
    font-size: 22px;
    line-height: 1;
  }

  .drawer-body {
    padding: 0 20px 20px;
  }

  .drawer-page-info {
    padding: 20px 0 16px;
  }

  .drawer-tabs {
    position: sticky;
    top: 84px;
    z-index: 1;
    display: flex;
    margin: 0 -20px;
    border-block: 1px solid var(--prd-color-border);
    padding: 8px 20px;
    background: rgb(255 255 255 / 97%);
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: thin;
  }

  .drawer-tabs button[role="tab"] {
    flex: 0 0 auto;
    min-width: max-content;
    border-color: transparent;
    padding: 8px 10px;
    background: transparent;
    color: #475569;
    box-shadow: none;
  }

  .drawer-tabs button[role="tab"][aria-selected="true"] {
    border-color: #fdba74;
    background: #fff7ed;
    color: #9a3412;
  }

  .drawer-panel {
    padding-top: 20px;
  }

  .page-document-switcher {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    gap: 8px;
    margin: -20px 0 12px;
    padding: 12px 0;
    background: var(--prd-color-surface);
  }

  .page-document-switcher button {
    min-width: 0;
    min-height: 36px;
    padding: 7px 10px;
  }

  .page-document-switcher button[aria-selected="true"] {
    border-color: #fdba74;
    background: #fff7ed;
    color: #9a3412;
  }

  [data-page-doc-panel][hidden] {
    display: none;
  }

  [data-hub-view="entries"] {
    display: grid;
    gap: 10px;
  }

  [data-hub-view][hidden] {
    display: none;
  }

  .document-hub-card {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 6px;
    padding: 14px;
    text-align: left;
  }

  .document-hub-card strong,
  .document-hub-counts {
    overflow-wrap: anywhere;
  }

  .document-hub-counts {
    color: #64748b;
    font-size: 12px;
    font-weight: 500;
  }

  .hub-back {
    margin-bottom: 14px;
  }

  [data-hub-view="detail"] > section {
    margin-top: 20px;
  }

  .drawer-panel[hidden] {
    display: none;
  }

  .drawer-panel [data-role="sync-help"] {
    margin-top: 24px;
    border-top: 1px solid var(--prd-color-border);
    padding-top: 20px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .drawer h3 {
    font-size: 15px;
  }

  [data-role="annotation-count"] {
    min-width: 24px;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #334155;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .annotation-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .annotation-list > li {
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
  }

  .annotation-card {
    display: block;
  }

  .annotation-card-header {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
  }

  .annotation-heading {
    min-width: 0;
  }

  .annotation-card-header .annotation-actions {
    margin-top: 0;
  }

  .annotation-sections {
    display: grid;
    gap: 10px;
    margin-top: 12px;
    /* Align section content with the title after the numbered marker. */
    padding-left: 40px;
  }

  .annotation-section {
    min-width: 0;
  }

  .annotation-section-label {
    margin: 0 0 4px;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  .annotation-section-content {
    margin: 0 !important;
    color: #334155;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .annotation-number {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 50%;
    background: #d97706;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
  }

  .annotation-content {
    min-width: 0;
  }

  .annotation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--prd-space-2);
    margin-top: 12px;
  }

  .linked-sections > li {
    display: list-item;
    border: 0;
    padding: 0;
    background: transparent;
    overflow-wrap: anywhere;
  }

  button.annotation-action {
    min-height: 32px;
    padding: 5px 10px;
    font-size: 12px;
  }

  button.annotation-delete {
    border-color: #fecaca;
    color: var(--prd-color-danger);
  }

  button.annotation-delete:hover {
    border-color: #fca5a5;
    background: #fef2f2;
  }

  .annotation-content p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .annotation-title {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .annotation-description {
    margin-top: 6px !important;
  }

  .annotation-prd-content,
  .annotation-detail {
    margin-top: 8px !important;
    color: #475569;
    font-size: 13px;
  }

  .annotation-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .annotation-type,
  .status,
  .impact {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .impact-global {
    background: #ffedd5;
    color: #9a3412;
  }

  .annotation-summary {
    margin-top: 10px !important;
    border-left: 2px solid #94a3b8;
    padding-left: 8px;
    color: #475569;
    font-size: 13px;
  }

  .linked-sections {
    margin: 8px 0 0;
    padding-left: 18px;
    color: #475569;
    font-size: 12px;
  }

  [data-role="prd-content"] {
    margin-top: 12px;
    color: #334155;
    overflow-wrap: anywhere;
  }

  [data-role="prd-content"] h1,
  [data-role="prd-content"] h2,
  [data-role="prd-content"] h3,
  [data-role="prd-content"] h4,
  [data-role="prd-content"] h5,
  [data-role="prd-content"] h6 {
    margin: 22px 0 8px;
    color: #17212b;
    line-height: 1.3;
  }

  [data-role="prd-content"] > :first-child {
    margin-top: 0;
  }

  [data-role="prd-content"] h1 {
    font-size: 22px;
  }

  [data-role="prd-content"] h2 {
    font-size: 18px;
  }

  [data-role="prd-content"] h3 {
    font-size: 15px;
  }

  [data-role="prd-content"] p,
  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol,
  [data-role="prd-content"] blockquote,
  [data-role="prd-content"] pre {
    margin: 8px 0;
  }

  [data-role="prd-content"] ul,
  [data-role="prd-content"] ol {
    padding-left: 22px;
  }

  [data-role="prd-content"] blockquote {
    border-left: 3px solid #d97706;
    padding: 8px 12px;
    background: #fff7ed;
    white-space: pre-wrap;
  }

  [data-role="prd-content"] pre {
    max-width: 100%;
    overflow: auto;
    border-radius: 6px;
    padding: 12px;
    background: #17212b;
    color: #e2e8f0;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  [data-role="prd-content"] hr {
    border: 0;
    border-top: 1px solid var(--prd-color-border);
    margin: 20px 0;
  }

  .markdown-table-scroll {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    border: 1px solid var(--prd-color-border);
    border-radius: 8px;
    background: #ffffff;
  }

  .markdown-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    color: #334155;
    font-size: 12px;
    line-height: 1.5;
  }

  .markdown-table th,
  .markdown-table td {
    min-width: 96px;
    max-width: 320px;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 10px;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  .markdown-table th {
    background: #f1f5f9;
    color: #17212b;
    font-weight: 700;
    white-space: nowrap;
  }

  .markdown-table tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  .markdown-table tr > :last-child {
    border-right: 0;
  }

  .markdown-table tbody tr:last-child > * {
    border-bottom: 0;
  }

  .markdown-table--empty thead tr > * {
    border-bottom: 0;
  }

  .markdown-table [data-align="center"] { text-align: center; }
  .markdown-table [data-align="right"] { text-align: right; }

  .markdown-inline-code {
    border-radius: 4px;
    padding: 1px 4px;
    background: #e2e8f0;
    color: #9a3412;
    font: 0.92em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    white-space: nowrap;
  }

  [data-role="prd-content"] a,
  .document-content a {
    color: #b45309;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  [data-role="page-metadata"],
  [data-role="sync-state"],
  [data-role="view-warning"] {
    color: #475569;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  [data-role="sync-state"][data-state="synced"] {
    color: #16835b;
  }

  [data-role="sync-state"][data-state="browser-only"],
  [data-role="sync-state"][data-state="memory-only"] {
    margin-top: 8px;
    border-left: 3px solid #b45309;
    padding: 8px 10px;
    background: #fff7ed;
    color: #9a3412;
  }

  .sync-instructions {
    display: grid;
    gap: 4px;
    margin: 10px 0 12px;
    padding-left: 22px;
    color: #475569;
    font-size: 13px;
  }

  .sync-copy-button {
    width: 100%;
  }

  .copy-result,
  .sync-fallback-label {
    margin-top: 10px !important;
    color: #475569;
    font-size: 12px;
  }

  .sync-prompt-fallback {
    display: block;
    width: 100%;
    min-height: 180px;
    margin-top: 8px;
    border: 1px solid #94a3b8;
    border-radius: var(--prd-radius);
    padding: 10px;
    background: #ffffff;
    color: var(--prd-color-text);
    font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    resize: vertical;
  }

  .page-metadata-generated {
    margin-top: 4px !important;
  }

  .view-warning,
  .document-warning {
    margin-top: 10px !important;
    border-left: 3px solid #b45309;
    padding: 8px 10px;
    background: #fff7ed;
    color: #9a3412;
    overflow-wrap: anywhere;
  }

  .document-group {
    display: grid;
    gap: 10px;
  }

  .document-group + .document-group {
    margin-top: 20px;
  }

  .document-group-title {
    margin: 0;
    color: #475569;
    font-size: 13px;
  }

  .document-card {
    border: 1px solid var(--prd-color-border);
    border-radius: var(--prd-radius);
    padding: 12px;
    background: #f8fafc;
    overflow-wrap: anywhere;
  }

  .document-title {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
  }

  .document-path {
    margin-top: 6px !important;
    color: #475569;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  .document-metadata {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .document-format,
  .document-kind,
  .document-preview-status {
    display: inline-block;
    border-radius: 999px;
    padding: 2px 7px;
    background: #e2e8f0;
    color: #475569;
    font-size: 11px;
  }

  .document-content {
    margin-top: 12px;
    color: #334155;
  }

  .document-content > :first-child {
    margin-top: 0;
  }

  .document-content h1,
  .document-content h2,
  .document-content h3,
  .document-content h4,
  .document-content h5,
  .document-content h6 {
    margin: 18px 0 8px;
    color: #17212b;
    line-height: 1.3;
  }

  .document-content p,
  .document-content ul,
  .document-content ol,
  .document-content blockquote,
  .document-content pre {
    margin: 8px 0;
  }

  .document-content ul,
  .document-content ol {
    padding-left: 22px;
  }

  .document-content pre {
    max-width: 100%;
    overflow: auto;
    border-radius: 6px;
    padding: 12px;
    background: #17212b;
    color: #e2e8f0;
    font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  }

  .empty-state {
    border: 1px dashed #cbd5e1;
    border-radius: var(--prd-radius);
    padding: 20px 12px;
    color: #64748b;
    text-align: center;
  }

  @media (max-width: 520px) {
    .tools {
      right: 12px;
      bottom: 12px;
    }

    .tools[data-collapsed="true"] {
      right: 0;
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    .tool-actions {
      gap: 6px;
    }

    button {
      padding-inline: 12px;
    }

    .annotation-card-header {
      grid-template-columns: 30px minmax(0, 1fr);
    }

    .annotation-card-header .annotation-actions {
      grid-column: 2;
    }

    .annotation-actions,
    .delete-dialog-actions {
      width: 100%;
      flex-wrap: wrap;
    }

    button.annotation-action {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
`;

  // prd-annotator/src/ui/shell.js
  function createShell(document2) {
    const host = document2.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>${styles}</style>
    <div class="overlay" data-role="overlay" aria-hidden="true"></div>
    <div class="tools" data-role="tool-launcher" data-collapsed="false" role="group" aria-label="PRD 标注工具">
      <div id="prd-annotator-tool-actions" class="tool-actions" data-role="tool-actions">
        <button type="button" data-role="tool-button" data-action="toggle-annotation" aria-pressed="false">标注模式</button>
        <button type="button" data-role="tool-button" data-action="toggle-drawer" aria-expanded="false">PRD 标注</button>
      </div>
      <button
        type="button"
        class="tool-launcher-toggle"
        data-role="tool-launcher-toggle"
        data-action="toggle-tool-launcher"
        data-annotation-active="false"
        aria-controls="prd-annotator-tool-actions"
        aria-expanded="true"
        aria-label="收起 PRD 标注工具"
      ><span class="tool-launcher-chevron" aria-hidden="true">›</span></button>
    </div>
    <section class="editor" data-role="editor" role="dialog" aria-modal="true" aria-label="添加标注" hidden></section>
    <aside class="drawer" data-role="drawer" aria-label="本页标注和页面 PRD" hidden>
      <header class="drawer-header">
        <div>
          <p class="eyebrow">当前页面</p>
          <h2 data-role="page-title"></h2>
        </div>
        <button type="button" class="drawer-close" data-action="close-drawer" aria-label="关闭 PRD 标注面板">×</button>
      </header>
      <div class="drawer-body">
        <section class="drawer-page-info" aria-label="页面信息">
          <div data-role="page-metadata"></div>
          <div data-role="sync-state" aria-live="polite"></div>
          <div data-role="view-warning" aria-live="polite"></div>
        </section>
        <div class="drawer-tabs" role="tablist" aria-label="页面资料">
          <button id="prd-tab-annotations" type="button" role="tab" data-tab="annotations" aria-selected="true" aria-controls="prd-panel-annotations">本页标注 <span data-role="annotation-count">0</span></button>
          <button id="prd-tab-page-prd" type="button" role="tab" data-tab="page-prd" aria-selected="false" aria-controls="prd-panel-page-prd">页面 PRD</button>
          <button id="prd-tab-field-spec" type="button" role="tab" data-tab="field-spec" aria-selected="false" aria-controls="prd-panel-field-spec">页面字段规范</button>
          <button id="prd-tab-api-doc" type="button" role="tab" data-tab="api-doc" aria-selected="false" aria-controls="prd-panel-api-doc">页面接口文档</button>
          <button id="prd-tab-related" type="button" role="tab" data-tab="related" aria-selected="false" aria-controls="prd-panel-related">关联文档</button>
        </div>
        <section id="prd-panel-annotations" class="drawer-panel" role="tabpanel" data-panel="annotations" aria-labelledby="prd-tab-annotations">
          <div class="section-heading">
            <h3>本页标注</h3>
          </div>
          <div data-role="annotation-list"></div>
          <section data-role="sync-help" aria-label="同步说明"></section>
        </section>
        <section id="prd-panel-page-prd" class="drawer-panel" role="tabpanel" data-panel="page-prd" aria-labelledby="prd-tab-page-prd" hidden>
          <div class="page-document-switcher" data-role="page-prd-switcher" role="tablist" aria-label="页面 PRD 资料">
            <button type="button" role="tab" data-page-doc-view="prd" aria-selected="true">页面 PRD</button>
            <button type="button" role="tab" data-page-doc-view="supplements" aria-selected="false">本页补充资料 <span data-role="supplement-count">0</span></button>
          </div>
          <div data-page-doc-panel="prd">
            <div data-role="prd-content"></div>
            <div data-role="document-page-prd"></div>
          </div>
          <div data-page-doc-panel="supplements" hidden>
            <div data-role="document-page-supplements"></div>
          </div>
        </section>
        <section id="prd-panel-field-spec" class="drawer-panel" role="tabpanel" data-panel="field-spec" aria-labelledby="prd-tab-field-spec" hidden>
          <div data-role="document-field-spec"></div>
        </section>
        <section id="prd-panel-api-doc" class="drawer-panel" role="tabpanel" data-panel="api-doc" aria-labelledby="prd-tab-api-doc" hidden>
          <div data-role="document-api-doc"></div>
        </section>
        <section id="prd-panel-related" class="drawer-panel" role="tabpanel" data-panel="related" aria-labelledby="prd-tab-related" hidden>
          <div data-role="document-hub">
            <div data-hub-view="entries"></div>
            <div data-hub-view="detail" hidden>
              <button type="button" class="secondary-button hub-back" data-action="back-to-document-hub">返回文档入口</button>
              <h3 data-role="hub-detail-title"></h3>
              <section aria-labelledby="hub-global-heading">
                <h4 id="hub-global-heading">全局文档</h4>
                <div data-role="hub-global-documents"></div>
              </section>
              <section aria-labelledby="hub-candidate-heading">
                <h4 id="hub-candidate-heading">待关联候选</h4>
                <div data-role="hub-candidate-documents"></div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </aside>
  `;
    const documentContainers = {
      "page-prd": shadow.querySelector("[data-role='document-page-prd']"),
      supplements: shadow.querySelector("[data-role='document-page-supplements']"),
      related: shadow.querySelector("[data-role='document-hub']"),
      "field-spec": shadow.querySelector("[data-role='document-field-spec']"),
      "api-doc": shadow.querySelector("[data-role='document-api-doc']")
    };
    return {
      host,
      shadow,
      overlay: shadow.querySelector("[data-role='overlay']"),
      editor: shadow.querySelector("[data-role='editor']"),
      drawer: shadow.querySelector("[data-role='drawer']"),
      toolLauncher: shadow.querySelector("[data-role='tool-launcher']"),
      toolActions: shadow.querySelector("[data-role='tool-actions']"),
      toolLauncherToggle: shadow.querySelector(
        "[data-role='tool-launcher-toggle']"
      ),
      annotationButton: shadow.querySelector("[data-action='toggle-annotation']"),
      drawerButton: shadow.querySelector("[data-action='toggle-drawer']"),
      closeDrawerButton: shadow.querySelector("[data-action='close-drawer']"),
      tabs: shadow.querySelectorAll(".drawer-tabs > [role='tab']"),
      panels: shadow.querySelectorAll(".drawer-body > [role='tabpanel']"),
      pageTitle: shadow.querySelector("[data-role='page-title']"),
      annotationCount: shadow.querySelector("[data-role='annotation-count']"),
      annotationList: shadow.querySelector("[data-role='annotation-list']"),
      prdContent: shadow.querySelector("[data-role='prd-content']"),
      pagePrdSwitcher: shadow.querySelector("[data-role='page-prd-switcher']"),
      supplementCount: shadow.querySelector("[data-role='supplement-count']"),
      pageMetadata: shadow.querySelector("[data-role='page-metadata']"),
      syncState: shadow.querySelector("[data-role='sync-state']"),
      viewWarning: shadow.querySelector("[data-role='view-warning']"),
      documentGroups: documentContainers.related,
      documentHub: documentContainers.related,
      documentContainers,
      syncHelp: shadow.querySelector("[data-role='sync-help']")
    };
  }

  // prd-annotator/src/ui/tabs.js
  function createTabController({ tabs, panels, initialId = "annotations" } = {}) {
    const orderedTabs = [...tabs || []];
    const orderedPanels = [...panels || []];
    if (!orderedTabs.length || orderedTabs.length !== orderedPanels.length) {
      throw new Error("Drawer tabs and panels must be non-empty and paired");
    }
    function select(id, { focus = false } = {}) {
      if (!orderedTabs.some((tab) => tab.dataset.tab === id)) {
        throw new Error(`Unknown Drawer tab: ${id}`);
      }
      for (const tab of orderedTabs) {
        const active = tab.dataset.tab === id;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focus) tab.focus();
      }
      for (const panel of orderedPanels) panel.hidden = panel.dataset.panel !== id;
    }
    function onKeyDown(event) {
      const index = orderedTabs.indexOf(event.currentTarget);
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!delta || index < 0) return;
      event.preventDefault();
      const next = orderedTabs[(index + delta + orderedTabs.length) % orderedTabs.length];
      select(next.dataset.tab, { focus: true });
    }
    for (const tab of orderedTabs) {
      tab.addEventListener("click", () => select(tab.dataset.tab));
      tab.addEventListener("keydown", onKeyDown);
    }
    select(initialId);
    return {
      select,
      reset: () => select(initialId)
    };
  }

  // prd-annotator/src/ui/tool-launcher.js
  var COLLAPSE_LABEL = "收起 PRD 标注工具";
  var EXPAND_LABEL = "展开 PRD 标注工具";
  var EXPAND_ACTIVE_LABEL = "展开 PRD 标注工具（标注模式已开启）";
  function applyToolLauncherState({
    launcher,
    actions,
    toggle,
    collapsed,
    annotationModeActive
  }) {
    const isCollapsed = Boolean(collapsed);
    const showActiveState = isCollapsed && Boolean(annotationModeActive);
    launcher.dataset.collapsed = String(isCollapsed);
    actions.hidden = isCollapsed;
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.dataset.annotationActive = String(showActiveState);
    toggle.setAttribute(
      "aria-label",
      isCollapsed ? showActiveState ? EXPAND_ACTIVE_LABEL : EXPAND_LABEL : COLLAPSE_LABEL
    );
  }

  // prd-annotator/src/ui/tool-launcher-preference.js
  function makeToolLauncherPreferenceKey(projectId) {
    return "prd-annotator:ui:v1:" + String(projectId) + ":launcher";
  }
  function normalizePreference(value, fallback) {
    return value && typeof value === "object" && typeof value.collapsed === "boolean" ? { collapsed: value.collapsed } : { collapsed: fallback.collapsed };
  }
  function createToolLauncherPreference({ storage, projectId }) {
    const key = makeToolLauncherPreferenceKey(projectId);
    let memory = { collapsed: false };
    function load() {
      try {
        const raw = storage?.getItem(key);
        if (raw !== null && raw !== void 0) {
          memory = normalizePreference(JSON.parse(raw), memory);
        }
      } catch {
      }
      return { ...memory };
    }
    function save(value) {
      memory = { collapsed: Boolean(value?.collapsed) };
      try {
        storage?.setItem(key, JSON.stringify(memory));
      } catch {
      }
      return { ...memory };
    }
    return Object.freeze({ key, load, save });
  }

  // prd-annotator/src/sync-prompt.js
  function computeSyncState({ currentFingerprint, persistedFingerprint, cacheStatus }) {
    if (cacheStatus?.mode === "memory") return "memory-only";
    return currentFingerprint === persistedFingerprint ? "synced" : "browser-only";
  }
  function buildSyncPrompt(context) {
    const payload = {
      annotationPath: context.annotationPath,
      document: context.document,
      fingerprint: context.fingerprint,
      htmlPath: context.htmlPath,
      manifestPath: context.manifestPath,
      pageId: context.pageId,
      projectId: context.projectId,
      viewPath: context.viewPath
    };
    return [
      "请将以下 PRD Annotator 本页标注同步到当前项目文件。",
      "复制提示词不代表同步成功；必须由 AI Agent 完成文件写入、重新生成 view 和项目 gate 后才算同步。",
      "本次只同步标注并重新生成 view，不修改任何 PRD。",
      "执行要求：验证 payload 的 projectId、pageId、annotationPath、viewPath、fingerprint 和标注必填字段；仅当 projectId 与 pageId 均匹配时才可合并；按 id 和 updatedAt 合并；绝不能将空浏览器快照视为清空永久数据的许可；绝不能减少永久标注 ID 集合；必须保留每一个仅存在于项目文件中的永久标注 ID；写入标注 JSON；重新生成本页 view；运行项目 gate；最后报告实际变更的文件和 gate 结果。",
      "不要编辑、改写、删除或新增任何 PRD 文件。",
      "---PRD_ANNOTATOR_PAYLOAD_START---",
      canonicalJson(payload),
      "---PRD_ANNOTATOR_PAYLOAD_END---"
    ].join("\n");
  }

  // prd-annotator/src/runtime/controller.js
  function clone2(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }
  function resolveBrowserStorage(window2) {
    try {
      return window2.localStorage;
    } catch {
      return null;
    }
  }
  function createAnnotation(formValue, target, id, timestamp) {
    return {
      id,
      title: formValue.title,
      description: formValue.description,
      type: formValue.type,
      prdContent: formValue.prdContent,
      note: formValue.note,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
      target: clone2(target),
      prd: {
        linkedDocuments: [],
        linkedSections: [],
        impactScope: "page",
        summary: ""
      }
    };
  }
  function editableAnnotationFields(formValue) {
    return {
      title: formValue.title,
      description: formValue.description,
      type: formValue.type,
      prdContent: formValue.prdContent,
      note: formValue.note
    };
  }
  function createAnnotator({
    window: window2,
    document: document2,
    scriptSrc = "",
    explicitPageId,
    explicitProjectId,
    basePage,
    routes = [],
    requestView = () => {
    },
    onViewHydrated = () => {
    },
    now = () => (/* @__PURE__ */ new Date()).toISOString()
  }) {
    const projectKey = resolveProjectKey({ explicitProjectId, scriptSrc });
    const browserStorage = resolveBrowserStorage(window2);
    const launcherPreference = createToolLauncherPreference({
      storage: browserStorage,
      projectId: projectKey
    });
    let launcherCollapsed = launcherPreference.load().collapsed;
    const hasConfiguredBasePage = Boolean(basePage);
    function documentBasePage(pathname) {
      const route = normalizeRoute(pathname || "/");
      const id = resolvePageId({
        explicitId: explicitPageId,
        pathname: route
      });
      return {
        id,
        title: document2.title || id,
        htmlPath: route.replace(/^\/+/, "") || "index.html",
        viewSrc: ""
      };
    }
    function resolveActiveIdentity(location = window2.location) {
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
        title: currentIdentity.title || document2.title || currentPageId,
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
        seed: `${normalizeRoute(window2.location?.pathname || "/")}#${currentIdentity.route}`
      });
    }
    function createPageCache() {
      const quarantinedPageId = quarantinedFallbackPageId();
      return createCacheStore({
        storage: browserStorage,
        key: makeStorageKey(projectKey, currentPageId),
        fallbackKeys: [
          ...makeLegacyStorageKeys({
            projectId: projectKey,
            pageId: currentPageId,
            scriptSrc,
            pathname: currentRoute,
            hasExplicitProjectId: Boolean(explicitProjectId)
          }),
          ...quarantinedPageId && quarantinedPageId !== currentPageId ? [makeStorageKey(projectKey, quarantinedPageId)] : []
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
    const registeredViews = /* @__PURE__ */ new Map();
    let shell = null;
    let disposers = [];
    let overlayController = null;
    let tabController = null;
    let pageDocumentController = null;
    let documentHub = null;
    let annotationModeActive = false;
    let pendingTarget = null;
    let editingAnnotationId = null;
    let returnFocus = null;
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
          const isMatchingCurrentV2Cache = cached.schemaVersion === SCHEMA_VERSION && cached.document.schemaVersion === SCHEMA_VERSION && legacyProjectId === projectKey && rawPageId === currentPageId;
          const isMatchingLegacyCache = cached.schemaVersion === 1 && (!legacyProjectId || legacyProjectId === projectKey) && rawPageId === resolveLegacyPageId({
            explicitId: explicitPageId,
            pathname: currentRoute
          });
          const isMatchingQuarantinedV2Cache = cached.schemaVersion === SCHEMA_VERSION && cached.document.schemaVersion === SCHEMA_VERSION && legacyProjectId === projectKey && rawPageId === quarantinedFallbackPageId();
          if (isMatchingCurrentV2Cache || isMatchingLegacyCache || isMatchingQuarantinedV2Cache) {
            documentState = {
              ...clone2(cachedDocument),
              page: {
                ...clone2(cachedDocument.page),
                ...currentPage()
              }
            };
            pagePrdMarkdown = typeof cached.pagePrdMarkdown === "string" ? cached.pagePrdMarkdown : "";
            try {
              viewDocuments = clone2(assertValidViewDocuments(cached.viewDocuments || []));
            } catch {
              viewDocuments = [];
            }
            persistedAnnotationFingerprint = typeof cached.persistedAnnotationFingerprint === "string" ? cached.persistedAnnotationFingerprint : "";
            viewGeneratedAt = typeof cached.viewGeneratedAt === "string" ? cached.viewGeneratedAt : "";
            if (cached.schemaVersion !== SCHEMA_VERSION || cached.document.schemaVersion !== SCHEMA_VERSION || isMatchingQuarantinedV2Cache) {
              persistCache();
            }
          }
        }
      } catch {
      }
    }
    loadCurrentPage();
    function getSnapshot() {
      return clone2({
        schemaVersion: SCHEMA_VERSION,
        projectId: projectKey,
        document: documentState,
        pagePrdMarkdown,
        documents: viewDocuments,
        persistedAnnotationFingerprint,
        annotationFingerprint: fingerprintValue(
          annotationFingerprintInput(documentState)
        ),
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
        fingerprint: fingerprintValue(annotationFingerprintInput(documentState)),
        document: clone2(documentState)
      });
    }
    function getSyncState() {
      return computeSyncState({
        currentFingerprint: fingerprintValue(annotationFingerprintInput(documentState)),
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
      const identities = [
        ...documentState.annotations,
        ...documentState.deletedAnnotations
      ];
      const highest = identities.reduce((maximum, annotation) => {
        const match = /^A(\d+)$/.exec(annotation.id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0);
      return `A${String(highest + 1).padStart(3, "0")}`;
    }
    function renderToolLauncher() {
      if (!shell) return;
      applyToolLauncherState({
        launcher: shell.toolLauncher,
        actions: shell.toolActions,
        toggle: shell.toolLauncherToggle,
        collapsed: launcherCollapsed,
        annotationModeActive
      });
    }
    function renderAll() {
      if (!shell) return;
      shell.pageTitle.textContent = documentState.page.title;
      shell.annotationCount.textContent = String(documentState.annotations.length);
      renderAnnotationList(shell.annotationList, documentState, {
        onEdit: startEdit,
        onDelete: requestDelete
      });
      renderPagePrd(shell.prdContent, pagePrdMarkdown);
      renderPageMetadata(shell.pageMetadata, documentState.page, viewGeneratedAt);
      pageDocumentController?.render({
        documents: viewDocuments,
        pageId: documentState.page.id,
        managedMarkdown: pagePrdMarkdown
      });
      documentHub?.render(viewDocuments);
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
      editingAnnotationId = null;
      pendingTarget = null;
      returnFocus = null;
      overlayController?.hideHover();
    }
    function focusAnnotationAction(annotationId, action = "edit-annotation") {
      window2.queueMicrotask(() => {
        const selector = annotationId ? `[data-action='${action}'][data-annotation-id='${annotationId}']` : "[data-role='annotation-list']";
        const target = shell?.shadow?.querySelector?.(selector) || shell?.shadow?.querySelector?.("[data-role='annotation-list']");
        target?.focus();
      });
    }
    function cancelCurrentEditor() {
      const focus = returnFocus;
      closeCurrentEditor();
      if (focus) focusAnnotationAction(focus.annotationId, focus.action);
    }
    function startEdit(annotationId) {
      const annotation = documentState.annotations.find(({ id }) => id === annotationId);
      if (!annotation || !shell) return;
      editingAnnotationId = annotationId;
      pendingTarget = clone2(annotation.target);
      returnFocus = { annotationId, action: "edit-annotation" };
      openEditor({
        container: shell.editor,
        target: pendingTarget,
        initialValue: annotation,
        onSave: savePendingAnnotation,
        onCancel: cancelCurrentEditor
      });
    }
    function requestDelete(annotationId) {
      const index = documentState.annotations.findIndex(({ id }) => id === annotationId);
      if (index < 0 || !shell) return;
      const annotation = documentState.annotations[index];
      const fallbackId = documentState.annotations[index + 1]?.id || documentState.annotations[index - 1]?.id || null;
      returnFocus = { annotationId, action: "delete-annotation", fallbackId };
      openDeleteDialog({
        container: shell.editor,
        annotation,
        displayNumber: annotationDisplayNumber(annotation, index),
        onConfirm: () => confirmDelete(annotationId),
        onCancel: cancelCurrentEditor
      });
    }
    async function copySyncPrompt() {
      const prompt = getSyncPrompt();
      try {
        const writeText = window2.navigator?.clipboard?.writeText;
        if (typeof writeText !== "function") throw new Error("Clipboard API unavailable");
        await writeText.call(window2.navigator.clipboard, prompt);
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
      const focus = returnFocus;
      if (editingAnnotationId) {
        const activeId = editingAnnotationId;
        if (!documentState.annotations.some(({ id }) => id === activeId)) {
          closeCurrentEditor();
          renderAll();
          return;
        }
        documentState = {
          ...documentState,
          annotations: documentState.annotations.map((annotation) => annotation.id === activeId ? {
            ...annotation,
            ...editableAnnotationFields(formValue),
            updatedAt: timestamp
          } : annotation)
        };
      } else {
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
      }
      persistCache();
      closeCurrentEditor();
      renderAll();
      if (focus) focusAnnotationAction(focus.annotationId, focus.action);
    }
    function confirmDelete(annotationId) {
      if (!documentState.annotations.some(({ id }) => id === annotationId)) {
        closeCurrentEditor();
        renderAll();
        return;
      }
      const deletedAt = now();
      const byId = new Map(
        documentState.deletedAnnotations.map((item) => [item.id, clone2(item)])
      );
      byId.set(annotationId, { id: annotationId, deletedAt });
      documentState = {
        ...documentState,
        annotations: documentState.annotations.filter(({ id }) => id !== annotationId),
        deletedAnnotations: [...byId.values()]
      };
      persistCache();
      const focus = returnFocus;
      closeCurrentEditor();
      renderAll();
      focusAnnotationAction(focus?.fallbackId || null, "edit-annotation");
    }
    function hydrate(input) {
      const activeIdentity = currentDocumentDefaults();
      const hydratedDocument = normalizeAnnotationDocument(
        input?.document,
        activeIdentity
      );
      assertValidDocument(hydratedDocument);
      if (hydratedDocument.projectId !== activeIdentity.projectId || hydratedDocument.page.id !== activeIdentity.page.id || hydratedDocument.page.title !== activeIdentity.page.title || hydratedDocument.page.htmlPath !== activeIdentity.page.htmlPath || hydratedDocument.page.route !== activeIdentity.page.route) {
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
      viewDocuments = clone2(viewBundle.documents);
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
      registeredViews.set(validated.page.id, clone2(validated));
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
      shell = createShell(document2);
      renderToolLauncher();
      const mountedShell = shell;
      tabController = createTabController({ tabs: mountedShell.tabs, panels: mountedShell.panels });
      pageDocumentController = createPageDocumentController({
        root: mountedShell.shadow,
        prdContainer: mountedShell.prdContent,
        pagePrdContainer: mountedShell.documentContainers["page-prd"],
        supplementContainer: mountedShell.documentContainers.supplements,
        fieldContainer: mountedShell.documentContainers["field-spec"],
        apiContainer: mountedShell.documentContainers["api-doc"]
      });
      documentHub = createDocumentHub({ root: mountedShell.documentHub });
      overlayController = createOverlayController({
        document: document2,
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
        editingAnnotationId = null;
        returnFocus = null;
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
        renderToolLauncher();
        if (active) {
          document2.addEventListener("pointermove", handlePointerMove, true);
          document2.addEventListener("click", handleTargetClick, true);
        } else {
          document2.removeEventListener("pointermove", handlePointerMove, true);
          document2.removeEventListener("click", handleTargetClick, true);
          overlayController?.hideHover();
          pendingTarget = null;
        }
      };
      const toggleAnnotation = () => {
        setAnnotationMode(!annotationModeActive);
      };
      const toggleToolLauncher = () => {
        launcherCollapsed = !launcherCollapsed;
        launcherPreference.save({ collapsed: launcherCollapsed });
        renderToolLauncher();
        mountedShell.toolLauncherToggle.focus();
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
          if (mountedShell.editor.dataset.dialog === "delete-confirmation") return;
          const hasReturnFocus = Boolean(returnFocus);
          cancelCurrentEditor();
          if (!hasReturnFocus) mountedShell.annotationButton.focus();
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
      const stopNavigation = observeNavigation(window2, (location) => {
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
        pageDocumentController.reset();
        documentHub.reset();
        renderAll();
        requestView(clone2(nextIdentity));
      });
      mountedShell.annotationButton.addEventListener("click", toggleAnnotation);
      mountedShell.toolLauncherToggle.addEventListener(
        "click",
        toggleToolLauncher
      );
      mountedShell.drawerButton.addEventListener("click", toggleDrawer);
      mountedShell.closeDrawerButton.addEventListener("click", closeDrawer);
      document2.addEventListener("keydown", handleKeyDown, true);
      disposers = [
        () => setAnnotationMode(false),
        closeCurrentEditor,
        stopNavigation,
        () => document2.removeEventListener("keydown", handleKeyDown, true),
        () => mountedShell.annotationButton.removeEventListener("click", toggleAnnotation),
        () => mountedShell.toolLauncherToggle.removeEventListener(
          "click",
          toggleToolLauncher
        ),
        () => mountedShell.drawerButton.removeEventListener("click", toggleDrawer),
        () => mountedShell.closeDrawerButton.removeEventListener("click", closeDrawer),
        () => overlayController?.destroy()
      ];
      document2.body.append(mountedShell.host);
    }
    function unmount() {
      for (const dispose of disposers.splice(0)) dispose();
      shell?.host.remove();
      overlayController = null;
      tabController = null;
      pageDocumentController = null;
      documentHub = null;
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

  // prd-annotator/src/runtime/route-registry.js
  function assert2(condition, message) {
    if (!condition) throw new Error(message);
  }
  function isProjectRelativePath2(value) {
    return typeof value === "string" && value === value.trim() && value.length > 0 && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:[\\/]/.test(value) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.split(/[\\/]+/).includes("..");
  }
  function assertPageReference(page, label) {
    assert2(page && typeof page === "object", `Invalid ${label}`);
    assert2(/^[a-z0-9-]{1,32}$/.test(page.id || ""), `Invalid ${label}.id`);
    assert2(typeof page.title === "string" && page.title.trim(), `Invalid ${label}.title`);
    assert2(isRelativeViewScriptSource(page.viewSrc), `${label}.viewSrc must be relative`);
  }
  function assertRoutePattern(value) {
    assert2(
      typeof value === "string" && value === value.trim() && value.startsWith("/") && !value.includes("\\") && !/[\r\n#]/.test(value),
      "Invalid route pattern"
    );
  }
  function assertValidRouteRegistry(value, expected = {}) {
    assert2(value && typeof value === "object", "Invalid route registry");
    assert2(value.schemaVersion === 2, "Unsupported route registry schemaVersion");
    assert2(typeof value.projectId === "string" && value.projectId.trim(), "Invalid route registry projectId");
    if (expected.projectId !== void 0) {
      assert2(value.projectId === expected.projectId, "Route registry projectId mismatch");
    }
    assert2(isProjectRelativePath2(value.htmlPath), "Invalid route registry htmlPath");
    assertPageReference(value.basePage, "route registry basePage");
    assert2(value.basePage.htmlPath === value.htmlPath, "Route registry basePage htmlPath mismatch");
    if (expected.pageId !== void 0) {
      assert2(value.basePage.id === expected.pageId, "Route registry pageId mismatch");
    }
    assert2(Array.isArray(value.routes), "Invalid route registry routes");
    const ids = /* @__PURE__ */ new Set([value.basePage.id]);
    const patterns = /* @__PURE__ */ new Set();
    for (const route of value.routes) {
      assertPageReference(route, "route registry page");
      assert2(!ids.has(route.id), "Duplicate route page id");
      assertRoutePattern(route.routePattern);
      assert2(!patterns.has(route.routePattern), "Duplicate route pattern");
      ids.add(route.id);
      patterns.add(route.routePattern);
    }
    return value;
  }
  async function loadRouteRegistryScript({
    window: window2,
    document: document2,
    src,
    expected
  }) {
    delete window2.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
    try {
      await loadViewScript({
        document: document2,
        src,
        loaderDataset: "prdAnnotatorRouteLoader"
      });
      return assertValidRouteRegistry(
        window2.__PRD_ANNOTATOR_ROUTE_REGISTRY__,
        expected
      );
    } finally {
      delete window2.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
    }
  }

  // prd-annotator/src/index.js
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
    const hydratedPageIds = /* @__PURE__ */ new Set();
    async function requestView(identity) {
      const token = ++viewRequestToken;
      if (!identity?.registered || !identity.viewSrc) {
        if (token === viewRequestToken) {
          api.reportViewLoadError(new Error(
            identity?.registered ? "PRD Annotator view source is missing" : "PRD Annotator route is not registered; ask the AI Agent to refresh the route map"
          ));
        }
        return;
      }
      try {
        await loadViewScript({
          document: windowObject.document,
          src: identity.viewSrc
        });
        if (token === viewRequestToken && api.getPageId() === identity.pageId && !hydratedPageIds.has(identity.pageId)) {
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
    const initialIdentity = activeIdentity.viewSrc || !script?.dataset.viewSrc ? activeIdentity : { ...activeIdentity, viewSrc: script.dataset.viewSrc };
    const ready = requestView(initialIdentity).then(() => api);
    return { api, ready };
  }
  function boot(windowObject = window) {
    if (windowObject.PRDAnnotator) return windowObject.PRDAnnotator;
    if (windowObject.PRDAnnotatorReady) return windowObject.PRDAnnotatorReady;
    const script = windowObject.document.currentScript;
    const routeSrc = script?.dataset.routeSrc;
    if (!routeSrc) {
      const { api, ready: ready2 } = createMountedAnnotator({
        windowObject,
        script,
        basePage: void 0,
        routes: void 0
      });
      windowObject.PRDAnnotatorReady = ready2;
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
})();
