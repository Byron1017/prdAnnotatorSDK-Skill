import { assertValidRoute } from "./route.mjs";

const SCHEMA_VERSION = 2;
const ANNOTATION_STATUSES = ["open", "needs-clarification", "applied", "superseded"];
const IMPACT_SCOPES = ["page", "global"];
const ANNOTATION_TYPES = ["requirement", "change", "question", "bug"];
const SDK_VERSION_PATTERN = /^2\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SDK_RELEASE_URL_PREFIX = "https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
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
    acceptanceCriteria: String(annotation.acceptanceCriteria || ""),
    dataFields: String(annotation.dataFields || ""),
    apiPath: String(annotation.apiPath || ""),
    edgeCases: String(annotation.edgeCases || ""),
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

function assertPath(value, label) {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintValue(value) {
  let hash = 0x811c9dc5;
  for (const character of canonicalJson(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function createEmptyAnnotationDocument(options = {}) {
  const { projectId, page } = options;
  const pageValue = page || options;
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectId === undefined ? undefined : String(projectId),
    page: asPage(pageValue),
    annotations: [],
    managedPrd: null
  };
}

export function normalizeAnnotationDocument(value, defaults = {}) {
  const source = value || {};
  const pageDefaults = defaults.page || defaults;
  return {
    ...clone(source),
    schemaVersion: SCHEMA_VERSION,
    projectId: String(source.projectId || defaults.projectId || ""),
    page: asPage(source.page, pageDefaults),
    annotations: Array.isArray(source.annotations)
      ? source.annotations.map(normalizeAnnotation)
      : [],
    managedPrd: source.managedPrd === undefined ? null : clone(source.managedPrd)
  };
}

export function normalizePageIdentity(page = {}) {
  if (page.identity === undefined) return { mode: "document" };
  if (
    page.identity?.mode === "document"
    && Object.keys(page.identity).length === 1
  ) {
    return page.identity;
  }
  if (
    page.identity?.mode === "hash-route"
    && Object.keys(page.identity).length === 2
  ) {
    assertValidRoute(page.identity.routePattern, "page.identity.routePattern");
    return {
      mode: "hash-route",
      routePattern: page.identity.routePattern
    };
  }
  throw new Error("Invalid page.identity");
}

export function validateAnnotationDocument(document) {
  if (document?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported schemaVersion");
  }
  if (!document.page?.id || !/^[a-z0-9-]{1,32}$/.test(document.page.id)) {
    throw new Error("Invalid page.id");
  }
  if (!Array.isArray(document.annotations)) {
    throw new Error("annotations must be an array");
  }
  for (const annotation of document.annotations) {
    if (!annotation.id || !annotation.title || !annotation.description || !annotation.target) {
      throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
    }
    if (!ANNOTATION_TYPES.includes(annotation.type)) throw new Error("Invalid annotation type");
    if (!ANNOTATION_STATUSES.includes(annotation.status)) throw new Error("Invalid annotation status");
    if (!IMPACT_SCOPES.includes(annotation.prd?.impactScope)) throw new Error("Invalid impact scope");
  }
  return document;
}

export function validateManifestV2(manifest) {
  if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported manifest schemaVersion");
  if (!/^[a-z0-9-]{1,32}$/.test(manifest.project?.id || "")) throw new Error("Invalid project.id");
  const sdk = manifest.project.sdk;
  if (
    !sdk
    || !SDK_VERSION_PATTERN.test(sdk.version || "")
    || sdk.releaseUrl !== `${SDK_RELEASE_URL_PREFIX}${sdk.version}`
    || !/^[a-f0-9]{64}$/.test(sdk.sha256 || "")
  ) {
    throw new Error("Invalid project.sdk");
  }
  assertTimestamp(sdk.installedAt, "project.sdk.installedAt");
  if (!Array.isArray(manifest.pages)) throw new Error("pages must be an array");
  if (!Array.isArray(manifest.documents)) throw new Error("documents must be an array");
  if (manifest.migration !== null && (typeof manifest.migration !== "object" || Array.isArray(manifest.migration))) throw new Error("Invalid migration");
  const pageIds = new Set();
  const pagesByHtmlPath = new Map();
  for (const page of manifest.pages) {
    if (!/^[a-z0-9-]{1,32}$/.test(page?.id || "") || pageIds.has(page.id)) throw new Error("Invalid page.id");
    pageIds.add(page.id);
    if (typeof page.title !== "string" || !page.title) throw new Error("Invalid page.title");
    assertPath(page.htmlPath, "page.htmlPath");
    assertPath(page.annotationFile, "page.annotationFile");
    assertPath(page.viewFile, "page.viewFile");
    if (page.annotationFile !== `.prd-annotator/data/pages/${page.id}.json`) throw new Error("Invalid page.annotationFile");
    if (page.viewFile !== `.prd-annotator/view/pages/${page.id}.js`) throw new Error("Invalid page.viewFile");
    if (typeof page.display?.enabled !== "boolean") throw new Error("Invalid page.display.enabled");
    assertTimestamp(page.display.updatedAt, "page.display.updatedAt");
    const identity = normalizePageIdentity(page);
    if (page.routeRegistryFile !== undefined) {
      assertPath(page.routeRegistryFile, "page.routeRegistryFile");
    }
    const group = pagesByHtmlPath.get(page.htmlPath) || [];
    group.push({ page, identity });
    pagesByHtmlPath.set(page.htmlPath, group);
  }
  for (const [htmlPath, group] of pagesByHtmlPath) {
    const documentPages = group.filter((entry) => entry.identity.mode === "document");
    if (documentPages.length !== 1) {
      throw new Error(`Expected exactly one document page for ${htmlPath}`);
    }
    const [baseEntry] = documentPages;
    const routeEntries = group.filter((entry) => entry.identity.mode === "hash-route");
    const routePatterns = new Set();
    for (const entry of routeEntries) {
      if (routePatterns.has(entry.identity.routePattern)) {
        throw new Error(`Duplicate route pattern for ${htmlPath}`);
      }
      routePatterns.add(entry.identity.routePattern);
      if (entry.page.routeRegistryFile !== undefined) {
        throw new Error("Hash route pages cannot define page.routeRegistryFile");
      }
      if (entry.page.display.enabled && !baseEntry.page.display.enabled) {
        throw new Error(`Enabled hash routes require an enabled document page for ${htmlPath}`);
      }
    }
    if (routeEntries.length) {
      const expectedRegistryFile = `.prd-annotator/view/routes/${baseEntry.page.id}.js`;
      if (baseEntry.page.routeRegistryFile !== expectedRegistryFile) {
        throw new Error(`Invalid page.routeRegistryFile for ${htmlPath}`);
      }
    } else if (baseEntry.page.routeRegistryFile !== undefined) {
      throw new Error(`Unexpected page.routeRegistryFile for ${htmlPath}`);
    }
  }
  if (manifest.migration?.routeClassifications !== undefined) {
    if (!Array.isArray(manifest.migration.routeClassifications)) {
      throw new Error("Invalid migration route classifications");
    }
    const basePageIds = new Set([...pagesByHtmlPath.values()]
      .flatMap((group) => group
        .filter((entry) => entry.identity.mode === "document")
        .map((entry) => entry.page.id)));
    const classifiedBasePageIds = new Set();
    for (const entry of manifest.migration.routeClassifications) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Invalid migration route classification");
      }
      if (!basePageIds.has(entry.basePageId)) {
        throw new Error("Invalid migration route classification base page");
      }
      if (classifiedBasePageIds.has(entry.basePageId)) {
        throw new Error("Duplicate migration route classification base page");
      }
      classifiedBasePageIds.add(entry.basePageId);
      if (!/^fnv1a32:[a-f0-9]{8}$/.test(entry.annotationFingerprint || "")) {
        throw new Error("Invalid migration route classification fingerprint");
      }
      if (entry.classification !== "legacy-unassigned") {
        throw new Error("Invalid migration route classification value");
      }
    }
  }
  return manifest;
}
