import { createHash } from "node:crypto";
import { canonicalJson, fingerprintValue } from "./schema.mjs";
import { documentDisplayGroups } from "./documents.mjs";

const PROJECT_DOCUMENT_KINDS = new Set(["total-prd", "public", "public-rule"]);
const TEXT_FORMATS = new Set(["markdown", "text", "json", "yaml"]);
const BINARY_FORMATS = new Set(["pdf", "docx"]);

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function compareDocuments(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalizeJsonForDisplay(source) {
  try {
    return JSON.stringify(JSON.parse(canonicalJson(JSON.parse(source))), null, 2);
  } catch {
    return source;
  }
}

function previewContent(documentEntry, previews) {
  if (documentEntry.missing) return { previewStatus: "missing", content: "" };
  const candidate = previews?.[documentEntry.path];
  if (TEXT_FORMATS.has(documentEntry.format)) {
    if (typeof candidate !== "string") return { previewStatus: "unavailable", content: "" };
    if (documentEntry.format === "json") {
      return { previewStatus: "available", content: normalizeJsonForDisplay(candidate) };
    }
    if (documentEntry.format === "yaml") {
      return { previewStatus: "available", content: candidate.replace(/\r\n?/g, "\n") };
    }
    return { previewStatus: "available", content: candidate };
  }
  if (BINARY_FORMATS.has(documentEntry.format) && typeof candidate === "string" && candidate.length > 0) {
    const fingerprint = `sha256:${createHash("sha256").update(candidate).digest("hex")}`;
    if (documentEntry.previewStatus !== "available" || documentEntry.previewFingerprint !== fingerprint) {
      throw new Error(`Binary preview fingerprint does not match document metadata: ${documentEntry.path}`);
    }
    return { previewStatus: "available", content: candidate };
  }
  if (
    BINARY_FORMATS.has(documentEntry.format)
    && (documentEntry.previewStatus === "available" || documentEntry.previewFingerprint != null)
  ) {
    throw new Error(`Binary preview content does not match document metadata: ${documentEntry.path}`);
  }
  return { previewStatus: "unavailable", content: "" };
}

function viewDocument(documentEntry, previews) {
  const preview = previewContent(documentEntry, previews);
  const result = {
    id: documentEntry.id,
    title: documentEntry.title,
    path: documentEntry.path,
    format: documentEntry.format,
    kind: documentEntry.kind,
    displayGroups: documentDisplayGroups(documentEntry),
    pageIds: clone(documentEntry.pageIds),
    fingerprint: documentEntry.fingerprint,
    previewStatus: preview.previewStatus,
    missing: documentEntry.missing,
    content: preview.content
  };
  if (BINARY_FORMATS.has(documentEntry.format)) {
    result.previewFingerprint = documentEntry.previewFingerprint ?? null;
  }
  return result;
}

export function buildViewBundle({ manifest, page, annotationDocument, documents, previews = {}, generatedAt } = {}) {
  if (!manifest?.project?.id || !page?.id || !annotationDocument || !Array.isArray(documents)) {
    throw new Error("Invalid view bundle inputs");
  }
  if (!manifest.pages?.some((entry) => entry.id === page.id)) throw new Error("Page is not authorized by manifest");
  if (annotationDocument.projectId !== manifest.project.id || annotationDocument.page?.id !== page.id) {
    throw new Error("Annotation document identity does not match page");
  }

  const direct = [];
  const projectLevel = [];
  const unclassified = [];
  for (const documentEntry of documents) {
    if (documentEntry.pageIds?.includes(page.id)) direct.push(documentEntry);
    else if (PROJECT_DOCUMENT_KINDS.has(documentEntry.kind)) projectLevel.push(documentEntry);
    else if (
      documentEntry.kind === "unclassified"
      || documentEntry.kind === "field-spec"
      || documentEntry.kind === "api-doc"
      || (documentEntry.kind === "page-prd" && documentEntry.pageIds?.length === 0)
    ) unclassified.push(documentEntry);
  }
  direct.sort(compareDocuments);
  projectLevel.sort(compareDocuments);
  unclassified.sort(compareDocuments);

  return {
    schemaVersion: 2,
    generatedAt: String(generatedAt),
    projectId: manifest.project.id,
    page: {
      id: page.id,
      title: page.title,
      htmlPath: page.htmlPath
    },
    persistedAnnotationFingerprint: fingerprintValue(annotationDocument.annotations),
    document: clone(annotationDocument),
    documents: [...direct, ...projectLevel, ...unclassified].map((entry) => viewDocument(entry, previews))
  };
}

export function serializeViewBundle(bundle) {
  return `window.PRDAnnotator.registerView(${canonicalJson(bundle)});\n`;
}
