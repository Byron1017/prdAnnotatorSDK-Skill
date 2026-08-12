import { SCHEMA_VERSION } from "./constants.js";
import { fingerprintValue } from "./fingerprint.js";
import {
  annotationFingerprintInput,
  assertValidDocument
} from "./model.js";
import { assertDocumentScope } from "./document-scope.js";

const PREVIEW_STATUSES = new Set(["available", "unavailable", "missing", "stale"]);
const DISPLAY_GROUPS = new Set(["page-prd", "related", "field-spec", "api-doc"]);
const FINGERPRINT_PATTERN = /^fnv1a32:[a-f0-9]{8}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isProjectRelativePath(value) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-zA-Z]:[\\/]/.test(value)
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    && !value.split(/[\\/]+/).includes("..");
}

export function isRelativeViewScriptSource(value) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-zA-Z]:[\\/]/.test(value)
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
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
  if (value.displayGroups !== undefined) {
    assert(
      Array.isArray(value.displayGroups)
      && value.displayGroups.length > 0
      && new Set(value.displayGroups).size === value.displayGroups.length
      && value.displayGroups.every((group) => DISPLAY_GROUPS.has(group)),
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

export function assertValidViewDocuments(documents) {
  assert(Array.isArray(documents), "View documents must be an array");
  const ids = new Set();
  for (const documentEntry of documents) {
    assertDocumentInventory(documentEntry);
    assert(!ids.has(documentEntry.id), "Duplicate document.id");
    ids.add(documentEntry.id);
  }
  return documents;
}

export function assertValidViewBundle(value, expected = {}) {
  assert(value && typeof value === "object", "Invalid view bundle");
  assert(value.schemaVersion === SCHEMA_VERSION, "Unsupported view schemaVersion");
  assert(typeof value.generatedAt === "string" && !Number.isNaN(Date.parse(value.generatedAt)), "Invalid view generatedAt");
  assert(typeof value.projectId === "string" && value.projectId.trim(), "Invalid view projectId");
  assertPage(value.page);
  if (expected.projectId !== undefined) {
    assert(value.projectId === expected.projectId, "View projectId does not match this page");
  }
  if (expected.pageId !== undefined) {
    assert(value.page.id === expected.pageId, "View page.id does not match this page");
  }

  assert(FINGERPRINT_PATTERN.test(value.persistedAnnotationFingerprint), "Invalid persistedAnnotationFingerprint");
  assertValidDocument(value.document);
  assert(value.document.projectId === value.projectId, "View document projectId does not match bundle");
  assert(value.document.page?.id === value.page.id, "View document page.id does not match bundle");
  assert(
    fingerprintValue(annotationFingerprintInput(value.document))
      === value.persistedAnnotationFingerprint,
    "persistedAnnotationFingerprint does not match annotations"
  );

  assertValidViewDocuments(value.documents);
  return value;
}

export function loadViewScript({
  document,
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
    const script = document.createElement("script");
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
    document.head.append(script);
  });
}
