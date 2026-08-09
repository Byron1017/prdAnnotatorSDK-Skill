const SCHEMA_VERSION = 2;
const ANNOTATION_STATUSES = ["open", "needs-clarification", "applied", "superseded"];
const IMPACT_SCOPES = ["page", "global"];
const ANNOTATION_TYPES = ["requirement", "change", "question", "bug"];

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
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
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
  if (!sdk || typeof sdk.version !== "string" || !sdk.version || typeof sdk.releaseUrl !== "string" || !/^https:\/\//.test(sdk.releaseUrl) || !/^[a-f0-9]{64}$/.test(sdk.sha256 || "")) {
    throw new Error("Invalid project.sdk");
  }
  assertTimestamp(sdk.installedAt, "project.sdk.installedAt");
  if (!Array.isArray(manifest.pages)) throw new Error("pages must be an array");
  if (!Array.isArray(manifest.documents)) throw new Error("documents must be an array");
  if (manifest.migration !== null && (typeof manifest.migration !== "object" || Array.isArray(manifest.migration))) throw new Error("Invalid migration");
  const pageIds = new Set();
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
  }
  return manifest;
}
