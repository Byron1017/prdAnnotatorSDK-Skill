import { createHash } from "node:crypto";
import {
  annotationFingerprintInput,
  canonicalJson,
  fingerprintValue
} from "./schema.mjs";
import { documentDisplayGroups } from "./documents.mjs";
import {
  documentBelongsToPage,
  inferDocumentScope,
  normalizeDocumentScope
} from "./document-scope.mjs";

const TEXT_FORMATS = new Set(["markdown", "text", "json", "yaml"]);
const BINARY_FORMATS = new Set(["pdf", "docx"]);
const SCOPE_ORDER = new Map([["page", 0], ["global", 1], ["unassigned", 2]]);

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function compareDocuments(left, right) {
  const scopeDifference = SCOPE_ORDER.get(inferDocumentScope(left)) - SCOPE_ORDER.get(inferDocumentScope(right));
  if (scopeDifference) return scopeDifference;
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
  const normalized = normalizeDocumentScope(documentEntry);
  const preview = previewContent(documentEntry, previews);
  const result = {
    id: documentEntry.id,
    title: documentEntry.title,
    path: documentEntry.path,
    format: documentEntry.format,
    kind: documentEntry.kind,
    displayGroups: documentDisplayGroups(documentEntry),
    scope: normalized.scope,
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

  const selected = documents
    .filter((entry) => documentBelongsToPage(entry, page.id)
      || inferDocumentScope(entry) === "global"
      || inferDocumentScope(entry) === "unassigned")
    .sort(compareDocuments);

  return {
    schemaVersion: 2,
    generatedAt: String(generatedAt),
    projectId: manifest.project.id,
    page: {
      id: page.id,
      title: page.title,
      htmlPath: page.htmlPath
    },
    persistedAnnotationFingerprint: fingerprintValue(
      annotationFingerprintInput(annotationDocument)
    ),
    document: clone(annotationDocument),
    documents: selected.map((entry) => viewDocument(entry, previews))
  };
}

export function serializeViewBundle(bundle) {
  return `window.PRDAnnotator.registerView(${canonicalJson(bundle)});\n`;
}
