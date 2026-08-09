import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { assertInsideProject, walkProject } from "./project.mjs";

const DOCUMENT_EXTENSIONS = Object.freeze([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".pdf", ".docx"
]);
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yaml", ".yml"]);
const FORMAT_BY_EXTENSION = Object.freeze({
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".pdf": "pdf",
  ".docx": "docx"
});

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertDocumentPath(value, label = "document path") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function documentId(relativePath) {
  return `doc-${createHash("sha256").update(relativePath).digest("hex").slice(0, 10)}`;
}

function fingerprint(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function titleFromSource(relativePath, text) {
  const heading = /^\s*#\s+(.+?)\s*$/m.exec(text || "")?.[1]?.trim();
  if (heading) return heading;
  const jsonTitle = (() => {
    if (path.posix.extname(relativePath).toLowerCase() !== ".json") return "";
    try {
      const value = JSON.parse(text);
      return typeof value?.title === "string" ? value.title.trim() : "";
    } catch {
      return "";
    }
  })();
  if (jsonTitle) return jsonTitle;
  const stem = path.posix.basename(relativePath).replace(/\.[^.]+$/, "");
  return stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || relativePath;
}

function classify(relativePath, text) {
  const lowerPath = relativePath.toLowerCase();
  const fileName = path.posix.basename(lowerPath).replace(/\.[^.]+$/, "");
  const sample = String(text || "").slice(0, 32_768).toLowerCase();
  const combined = `${lowerPath}\n${sample}`;
  const evidence = [`supported document extension ${path.posix.extname(lowerPath)}`];

  const hasPrd = /(^|[^a-z0-9])prd([^a-z0-9]|$)/.test(combined)
    || /product\s+requirements?\s+document/.test(sample);
  const totalSignal = /^(?:prd|total[-_ ]?prd|product[-_ ]?prd|master[-_ ]?prd)$/.test(fileName)
    || /(?:^|[/_-])(total|global|master|product)[-_ ]?prd(?:$|[/_.-])/.test(lowerPath)
    || /#\s*(?:total|global|master|product)\s+(?:requirements?|prd)/.test(sample);
  const pageSignal = /(?:^|[/_-])(?:page|screen|view)[-_ ]?prd(?:$|[/_.-])/.test(lowerPath)
    || /#\s*(?:page|screen|view)\s+(?:requirements?|prd)/.test(sample);
  const requirementSignal = /requirements?|spec(?:ification)?s?|rules?|acceptance[-_ ]?criteria/.test(combined);
  const otherSignal = /flows?|journeys?|questions?|decisions?|notes?|stories?/.test(combined);

  if (hasPrd && totalSignal) {
    evidence.push("filename or heading indicates a project-level PRD");
    return { kind: "total-prd", evidence };
  }
  if (hasPrd && pageSignal) {
    evidence.push("filename or heading indicates a page PRD");
    return { kind: "page-prd", evidence };
  }
  if (hasPrd) {
    evidence.push("path or content contains ambiguous PRD evidence");
    return { kind: "unclassified", evidence };
  }
  if (requirementSignal) {
    evidence.push("path or content contains requirement/rule evidence");
    return { kind: "requirement", evidence };
  }
  if (otherSignal) {
    evidence.push("path or content contains related product-work evidence");
    return { kind: "other", evidence };
  }
  evidence.push("no reliable kind or association evidence");
  return { kind: "unclassified", evidence };
}

async function readSafeBytes(projectRoot, relativePath) {
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  assertInsideProject(projectRoot, absolutePath, relativePath);
  const status = await lstat(absolutePath);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Unsafe document source: ${relativePath}`);
  return readFile(absolutePath);
}

function retainedMissingDocument(entry) {
  const result = clone(entry);
  result.missing = true;
  result.previewStatus = "missing";
  return result;
}

export async function discoverDocuments({ projectRoot, existingDocuments = [] } = {}) {
  if (!Array.isArray(existingDocuments)) throw new Error("existingDocuments must be an array");
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const existingByPath = new Map();
  for (const entry of existingDocuments) {
    assertDocumentPath(entry?.path, "existing document path");
    if (existingByPath.has(entry.path)) throw new Error(`Duplicate existing document path: ${entry.path}`);
    existingByPath.set(entry.path, entry);
  }

  const discoveredPaths = await walkProject(normalizedRoot, { extensions: DOCUMENT_EXTENSIONS });
  const discovered = [];
  const seenPaths = new Set();
  for (const relativePath of discoveredPaths) {
    assertDocumentPath(relativePath);
    const extension = path.posix.extname(relativePath).toLowerCase();
    const bytes = await readSafeBytes(normalizedRoot, relativePath);
    const text = TEXT_EXTENSIONS.has(extension) ? bytes.toString("utf8") : "";
    const suggestion = classify(relativePath, text);
    const existing = existingByPath.get(relativePath);
    const isManual = existing?.associationSource === "manual";
    const entry = {
      id: String(existing?.id || documentId(relativePath)),
      path: relativePath,
      title: String(existing?.title || titleFromSource(relativePath, text)),
      format: FORMAT_BY_EXTENSION[extension],
      kind: isManual ? String(existing.kind || suggestion.kind) : suggestion.kind,
      pageIds: isManual && Array.isArray(existing.pageIds) ? clone(existing.pageIds) : [],
      associationSource: isManual ? "manual" : "discovered",
      evidence: isManual && Array.isArray(existing.evidence) && existing.evidence.length
        ? clone(existing.evidence)
        : suggestion.evidence,
      fingerprint: fingerprint(bytes),
      previewStatus: TEXT_EXTENSIONS.has(extension) ? "available" : "unavailable",
      missing: false
    };
    discovered.push(entry);
    seenPaths.add(relativePath);
  }

  for (const existing of existingDocuments) {
    if (!seenPaths.has(existing.path)) discovered.push(retainedMissingDocument(existing));
  }
  return discovered.sort((left, right) => compareText(left.path, right.path) || compareText(left.id, right.id));
}

export const DOCUMENT_FORMATS = Object.freeze({
  text: new Set(["markdown", "text", "json", "yaml"]),
  binary: new Set(["pdf", "docx"])
});
