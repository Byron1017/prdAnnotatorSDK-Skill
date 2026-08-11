import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverDocuments, DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { inspectIntegration, relativeWebPath } from "./lib/html.mjs";
import { assertInsideProject } from "./lib/project.mjs";
import { readSdkVersion } from "./lib/release.mjs";
import { renderManagedPagePrd, renderManagedTotalPrd } from "./lib/managed-prd.mjs";
import { assertValidRoute } from "./lib/route.mjs";
import {
  canonicalJson,
  fingerprintValue,
  normalizePageIdentity,
  validateManifestV2
} from "./lib/schema.mjs";
import {
  buildRouteRegistry,
  serializeRouteRegistry
} from "./lib/route-registry.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const SDK_PATH = ".prd-annotator/sdk/prd-annotator.js";
const USAGE = "Usage: check-project.mjs --project-root PATH";
const PAGE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FINGERPRINT_PATTERN = /^fnv1a32:[a-f0-9]{8}$/;
const ANNOTATION_TYPES = new Set(["requirement", "change", "question", "bug"]);
const ANNOTATION_STATUSES = new Set(["open", "needs-clarification", "applied", "superseded"]);
const IMPACT_SCOPES = new Set(["page", "global"]);
const DOCUMENT_FORMAT_VALUES = new Set(["markdown", "text", "json", "yaml", "pdf", "docx"]);
const DOCUMENT_KIND_VALUES = new Set([
  "total-prd",
  "page-prd",
  "requirement",
  "other",
  "unclassified",
  "public",
  "public-rule"
]);
const ASSOCIATION_SOURCE_VALUES = new Set(["discovered", "manual"]);
const PREVIEW_STATUS_VALUES = new Set(["available", "unavailable", "missing"]);
const PROJECT_DOCUMENT_KINDS = new Set(["total-prd", "public", "public-rule"]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
}

function assertString(value, label) {
  if (typeof value !== "string") fail(`${label} must be a string`);
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    fail(`${label} must be an ISO timestamp`);
  }
}

export function assertProjectRelativePath(value, label) {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.includes("\\")
    || value.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail(`Invalid ${label}`);
  }
  return value;
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function assertSafeProjectFile(
  projectRoot,
  relativePath,
  label,
  { allowMissing = false } = {}
) {
  assertProjectRelativePath(relativePath, label);
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const absolutePath = path.resolve(normalizedRoot, ...relativePath.split("/"));
  assertInsideProject(normalizedRoot, absolutePath, label);
  const rootStatus = await pathStatus(normalizedRoot);
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) {
    fail(`Unsafe ${label} ancestor: project root`);
  }
  const resolvedRoot = await realpath(normalizedRoot);
  let current = normalizedRoot;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const status = await pathStatus(current);
    const isTarget = index === segments.length - 1;
    const partialPath = segments.slice(0, index + 1).join("/");
    if (!status) {
      if (allowMissing) return { absolutePath, exists: false };
      fail(`Invalid ${label}: ${relativePath} does not exist`);
    }
    if (status.isSymbolicLink()) {
      fail(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${partialPath}`);
    }
    if (!isTarget && !status.isDirectory()) fail(`Unsafe ${label} ancestor: ${partialPath}`);
    if (isTarget && !status.isFile()) fail(`Unsafe ${label} target: ${relativePath}`);
    const resolvedCurrent = await realpath(current);
    try {
      assertInsideProject(resolvedRoot, resolvedCurrent, label);
    } catch {
      fail(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${partialPath}`);
    }
  }
  return { absolutePath, exists: true };
}

async function readSafeText(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  return readFile(absolutePath, "utf8");
}

async function readSafeJson(projectRoot, relativePath, label) {
  const source = await readSafeText(projectRoot, relativePath, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

function assertStringArray(value, label, { nonEmptyItems = true } = {}) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  for (const item of value) {
    if (typeof item !== "string" || (nonEmptyItems && !item.trim())) {
      fail(`${label} must contain ${nonEmptyItems ? "non-empty " : ""}strings`);
    }
  }
}

function assertManagedPrd(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  assertNonEmptyString(value.title, `${label}.title`);
  if (!Array.isArray(value.sections)) fail(`${label}.sections must be an array`);
  const sectionIds = new Set();
  for (const section of value.sections) {
    if (!isRecord(section)) fail(`${label}.sections must contain objects`);
    assertNonEmptyString(section.id, `${label}.section.id`);
    if (sectionIds.has(section.id)) fail(`${label} has duplicate section id ${section.id}`);
    sectionIds.add(section.id);
    assertNonEmptyString(section.title, `${label}.section ${section.id}.title`);
    assertStringArray(section.blocks, `${label}.section ${section.id}.blocks`);
  }
}

export function validateCompleteAnnotationDocument(document, { label = "annotation", documentIds } = {}) {
  if (!isRecord(document) || document.schemaVersion !== 2) fail(`${label} schemaVersion must be 2`);
  assertNonEmptyString(document.projectId, `${label} projectId`);
  if (!isRecord(document.page) || !PAGE_ID_PATTERN.test(document.page.id || "")) {
    fail(`${label} page.id must be ASCII lowercase letters, digits, or hyphens and at most 32 characters`);
  }
  assertNonEmptyString(document.page.title, `${label} page.title`);
  assertProjectRelativePath(document.page.htmlPath, `${label} page.htmlPath`);
  assertValidRoute(document.page.route, `${label} page.route`);
  if (!Array.isArray(document.annotations)) fail(`${label} annotations must be an array`);

  const annotationIds = new Set();
  for (const annotation of document.annotations) {
    const annotationLabel = `annotation ${annotation?.id || "<missing>"}`;
    if (!isRecord(annotation)) fail(`${annotationLabel} must be an object`);
    assertNonEmptyString(annotation.id, `${annotationLabel}.id`);
    if (annotationIds.has(annotation.id)) fail(`duplicate annotation id ${annotation.id}`);
    annotationIds.add(annotation.id);
    assertNonEmptyString(annotation.title, `${annotationLabel}.title`);
    assertNonEmptyString(annotation.description, `${annotationLabel}.description`);
    if (!ANNOTATION_TYPES.has(annotation.type)) {
      fail(`${annotationLabel}.type must be one of ${[...ANNOTATION_TYPES].join(", ")}`);
    }
    assertNonEmptyString(annotation.prdContent, `${annotationLabel}.prdContent`);
    for (const field of ["acceptanceCriteria", "dataFields", "apiPath", "edgeCases"]) {
      assertString(annotation[field], `${annotationLabel}.${field}`);
    }
    if (!ANNOTATION_STATUSES.has(annotation.status)) {
      fail(`${annotationLabel}.status must be one of ${[...ANNOTATION_STATUSES].join(", ")}`);
    }
    assertIsoTimestamp(annotation.createdAt, `${annotationLabel}.createdAt`);
    assertIsoTimestamp(annotation.updatedAt, `${annotationLabel}.updatedAt`);
    if (Date.parse(annotation.updatedAt) < Date.parse(annotation.createdAt)) {
      fail(`${annotationLabel}.updatedAt must not be earlier than createdAt`);
    }
    if (!isRecord(annotation.target)) fail(`${annotationLabel}.target must be an object`);
    for (const field of ["cssPath", "xpath", "textQuote"]) {
      assertString(annotation.target[field], `${annotationLabel}.target.${field}`);
    }
    if (!isRecord(annotation.target.rect)) fail(`${annotationLabel}.target.rect must be an object`);
    for (const field of ["x", "y", "width", "height"]) {
      if (typeof annotation.target.rect[field] !== "number" || !Number.isFinite(annotation.target.rect[field])) {
        fail(`${annotationLabel}.target.rect.${field} must be a finite number`);
      }
    }
    if (annotation.target.rect.width < 0 || annotation.target.rect.height < 0) {
      fail(`${annotationLabel}.target.rect dimensions must be non-negative`);
    }
    if (!isRecord(annotation.prd)) fail(`${annotationLabel}.prd must be an object`);
    assertStringArray(annotation.prd.linkedDocuments, `${annotationLabel}.prd.linkedDocuments`);
    assertStringArray(annotation.prd.linkedSections, `${annotationLabel}.prd.linkedSections`);
    if (!IMPACT_SCOPES.has(annotation.prd.impactScope)) {
      fail(`${annotationLabel}.prd.impactScope must be one of ${[...IMPACT_SCOPES].join(", ")}`);
    }
    assertString(annotation.prd.summary, `${annotationLabel}.prd.summary`);
    if (annotation.status === "applied" && annotation.prd.linkedSections.length === 0) {
      fail(`applied annotation ${annotation.id} must link to a PRD section`);
    }
    if (documentIds) {
      for (const linkedId of annotation.prd.linkedDocuments) {
        if (!documentIds.has(linkedId)) fail(`${annotationLabel} links unknown document ${linkedId}`);
      }
    }
  }
  if (document.managedPrd !== null) assertManagedPrd(document.managedPrd, `${label} managedPrd`);
  return document;
}

function validateDocumentEntry(entry, knownPageIds, ids, paths) {
  if (!isRecord(entry)) fail("manifest documents must contain objects");
  assertNonEmptyString(entry.id, "document.id");
  if (ids.has(entry.id)) fail(`duplicate document id ${entry.id}`);
  ids.add(entry.id);
  assertNonEmptyString(entry.title, `document ${entry.id}.title`);
  assertProjectRelativePath(entry.path, `document ${entry.id}.path`);
  if (paths.has(entry.path)) fail(`duplicate document path ${entry.path}`);
  paths.add(entry.path);
  if (!DOCUMENT_FORMAT_VALUES.has(entry.format)) fail(`invalid document format for ${entry.id}`);
  if (!DOCUMENT_KIND_VALUES.has(entry.kind)) fail(`invalid document kind for ${entry.id}`);
  assertStringArray(entry.pageIds, `document ${entry.id}.pageIds`);
  if (new Set(entry.pageIds).size !== entry.pageIds.length) fail(`duplicate page id mapping for ${entry.id}`);
  for (const pageId of entry.pageIds) {
    if (!knownPageIds.has(pageId)) fail(`document ${entry.id} references unknown page ${pageId}`);
  }
  if (!ASSOCIATION_SOURCE_VALUES.has(entry.associationSource)) fail(`invalid association source for ${entry.id}`);
  assertStringArray(entry.evidence, `document ${entry.id}.evidence`);
  if (!SHA256_PATTERN.test(entry.fingerprint || "")) fail(`invalid document fingerprint for ${entry.id}`);
  if (!PREVIEW_STATUS_VALUES.has(entry.previewStatus)) fail(`invalid document previewStatus for ${entry.id}`);
  if (typeof entry.missing !== "boolean") fail(`document ${entry.id}.missing must be a boolean`);
  if (entry.managed !== undefined && typeof entry.managed !== "boolean") {
    fail(`document ${entry.id}.managed must be a boolean`);
  }
  if (entry.missing !== (entry.previewStatus === "missing")) {
    fail(`document ${entry.id} missing state does not match previewStatus`);
  }
  if (DOCUMENT_FORMATS.binary.has(entry.format)) {
    const validAvailable = entry.previewStatus === "available" && SHA256_PATTERN.test(entry.previewFingerprint || "");
    const validEmpty = ["unavailable", "missing"].includes(entry.previewStatus)
      && (entry.previewFingerprint === null || entry.previewFingerprint === undefined);
    if (!validAvailable && !validEmpty) fail(`invalid binary preview metadata for ${entry.id}`);
  }
}

function parseViewSource(source, pageId) {
  const suffix = ");\n";
  const prefix = [
    "window.PRDAnnotator.registerView(",
    "window.PRDAnnotator.hydrateView("
  ].find((candidate) => source.startsWith(candidate));
  if (!prefix || !source.endsWith(suffix)) {
    fail(`invalid view source for ${pageId}`);
  }
  try {
    return JSON.parse(source.slice(prefix.length, -suffix.length));
  } catch (error) {
    fail(`invalid view JSON for ${pageId}: ${error.message}`);
  }
}

function parseRouteRegistrySource(source, basePageId) {
  const prefix = "window.__PRD_ANNOTATOR_ROUTE_REGISTRY__=";
  const suffix = ";\n";
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) {
    fail(`invalid route registry source for ${basePageId}`);
  }
  try {
    return JSON.parse(source.slice(prefix.length, -suffix.length));
  } catch (error) {
    fail(`invalid route registry JSON for ${basePageId}: ${error.message}`);
  }
}

function validateRouteRegistryIdentity(manifest, basePage, registry) {
  if (registry?.schemaVersion !== 2) fail("route registry schemaVersion does not match manifest");
  if (registry.projectId !== manifest.project.id) fail("route registry projectId does not match manifest");
  if (registry.htmlPath !== basePage.htmlPath) fail("route registry htmlPath does not match manifest");
  const expectedBase = {
    id: basePage.id,
    title: basePage.title,
    htmlPath: basePage.htmlPath,
    viewSrc: relativeWebPath(basePage.htmlPath, basePage.viewFile)
  };
  if (canonicalJson(registry.basePage) !== canonicalJson(expectedBase)) {
    fail("route registry base page does not match manifest");
  }
  if (!Array.isArray(registry.routes)) fail("route registry routes must be an array");
  const knownRoutes = new Map(manifest.pages
    .filter((page) => (
      page.htmlPath === basePage.htmlPath
      && normalizePageIdentity(page).mode === "hash-route"
    ))
    .map((page) => [page.id, page]));
  const seenIds = new Set();
  const seenPatterns = new Set();
  for (const route of registry.routes) {
    const page = knownRoutes.get(route?.id);
    const expected = page && {
      id: page.id,
      title: page.title,
      htmlPath: page.htmlPath,
      viewSrc: relativeWebPath(basePage.htmlPath, page.viewFile),
      routePattern: normalizePageIdentity(page).routePattern
    };
    if (
      !expected
      || seenIds.has(route.id)
      || seenPatterns.has(route.routePattern)
      || canonicalJson(route) !== canonicalJson(expected)
    ) {
      fail("route registry route does not match manifest");
    }
    seenIds.add(route.id);
    seenPatterns.add(route.routePattern);
  }
}

function assertLocalReference(projectRoot, htmlPath, reference, label) {
  if (
    typeof reference !== "string"
    || !reference
    || reference !== reference.trim()
    || reference.includes("\\")
    || reference.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(reference)
    || reference.includes("?")
    || reference.includes("#")
  ) {
    fail(`${label} must be a local relative URL`);
  }
  const htmlAbsolute = path.resolve(projectRoot, ...htmlPath.split("/"));
  const resolved = path.resolve(path.dirname(htmlAbsolute), ...reference.split("/"));
  try {
    assertInsideProject(projectRoot, resolved, label);
  } catch {
    fail(`${label} resolves outside project root`);
  }
  return resolved;
}

function assertIntegration(projectRoot, manifest, page, html) {
  const integrations = inspectIntegration(html);
  if (page.display.enabled && integrations.length !== 1) {
    fail(`page ${page.id} must have exactly one PRD Annotator integration`);
  }
  if (!page.display.enabled && integrations.length !== 0) {
    fail(`disabled page ${page.id} must have zero PRD Annotator integrations`);
  }
  if (!page.display.enabled) return;
  const [integration] = integrations;
  if (integration.projectId !== manifest.project.id) fail("integration projectId does not match manifest");
  if (integration.pageId !== page.id) fail("integration pageId does not match manifest");
  const sdkResolved = assertLocalReference(projectRoot, page.htmlPath, integration.src, "src");
  const viewResolved = assertLocalReference(projectRoot, page.htmlPath, integration.viewSrc, "data-view-src");
  const expectedSdk = path.resolve(projectRoot, ...SDK_PATH.split("/"));
  const expectedView = path.resolve(projectRoot, ...page.viewFile.split("/"));
  if (sdkResolved !== expectedSdk || integration.src !== relativeWebPath(page.htmlPath, SDK_PATH)) {
    fail("src does not match manifest SDK path");
  }
  if (viewResolved !== expectedView || integration.viewSrc !== relativeWebPath(page.htmlPath, page.viewFile)) {
    fail("data-view-src does not match manifest view path");
  }
  if (page.routeRegistryFile) {
    const routeResolved = assertLocalReference(
      projectRoot,
      page.htmlPath,
      integration.routeSrc,
      "data-route-src"
    );
    const expectedRoute = path.resolve(projectRoot, ...page.routeRegistryFile.split("/"));
    if (
      routeResolved !== expectedRoute
      || integration.routeSrc !== relativeWebPath(page.htmlPath, page.routeRegistryFile)
    ) {
      fail("data-route-src does not match manifest route registry path");
    }
  } else if (integration.routeSrc) {
    fail("data-route-src requires a manifest route registry path");
  }
}

function normalizeJsonForDisplay(source) {
  try {
    return JSON.stringify(JSON.parse(canonicalJson(JSON.parse(source))), null, 2);
  } catch {
    return source;
  }
}

function expectedTextContent(entry, source) {
  if (entry.format === "json") return normalizeJsonForDisplay(source);
  if (entry.format === "yaml") return source.replace(/\r\n?/g, "\n");
  return source;
}

function expectedViewDocuments(documents, pageId) {
  const compare = (left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  const direct = documents.filter((entry) => entry.pageIds.includes(pageId)).sort(compare);
  const projectLevel = documents
    .filter((entry) => !entry.pageIds.includes(pageId) && PROJECT_DOCUMENT_KINDS.has(entry.kind))
    .sort(compare);
  const unclassified = documents
    .filter((entry) => !entry.pageIds.includes(pageId)
      && !PROJECT_DOCUMENT_KINDS.has(entry.kind)
      && (entry.kind === "unclassified" || (entry.kind === "page-prd" && entry.pageIds.length === 0)))
    .sort(compare);
  return [...direct, ...projectLevel, ...unclassified];
}

async function validateViewDocuments(projectRoot, page, view, manifestDocuments) {
  if (!Array.isArray(view.documents)) fail(`view documents must be an array for ${page.id}`);
  const ids = new Set();
  const paths = new Set();
  for (const entry of view.documents) {
    assertNonEmptyString(entry?.id, "view document.id");
    if (ids.has(entry.id)) fail(`duplicate view document id ${entry.id}`);
    ids.add(entry.id);
    assertProjectRelativePath(entry.path, `view document ${entry.id}.path`);
    if (paths.has(entry.path)) fail(`duplicate view document path ${entry.path}`);
    paths.add(entry.path);
    if (!SHA256_PATTERN.test(entry.fingerprint || "")) fail(`invalid view fingerprint for ${entry.id}`);
    if (![...PREVIEW_STATUS_VALUES, "stale"].includes(entry.previewStatus)) {
      fail(`invalid view status for ${entry.id}`);
    }
    if (typeof entry.missing !== "boolean" || typeof entry.content !== "string") {
      fail(`invalid view document ${entry.id}`);
    }
    if (
      DOCUMENT_FORMATS.binary.has(entry.format)
      && entry.previewFingerprint !== null
      && entry.previewFingerprint !== undefined
      && !SHA256_PATTERN.test(entry.previewFingerprint)
    ) {
      fail(`invalid view preview fingerprint for ${entry.id}`);
    }
  }
  const expected = expectedViewDocuments(manifestDocuments, page.id);
  if (
    expected.length !== view.documents.length
    || expected.some((entry, index) => entry.id !== view.documents[index]?.id)
  ) {
    fail(`view document inventory is incomplete for ${page.id}`);
  }

  for (let index = 0; index < expected.length; index += 1) {
    const manifestEntry = expected[index];
    const viewEntry = view.documents[index];
    for (const field of ["title", "path", "format", "kind", "missing"]) {
      if (canonicalJson(viewEntry[field]) !== canonicalJson(manifestEntry[field])) {
        fail(`view document ${field} does not match manifest for ${manifestEntry.id}`);
      }
    }
    if (canonicalJson(viewEntry.pageIds) !== canonicalJson(manifestEntry.pageIds)) {
      fail(`view document pageIds do not match manifest for ${manifestEntry.id}`);
    }
    const sourceStatus = await assertSafeProjectFile(
      projectRoot,
      manifestEntry.path,
      `document source ${manifestEntry.id}`,
      { allowMissing: true }
    );
    if (!sourceStatus.exists) {
      if (!manifestEntry.missing) fail(`missing document must be explicitly marked missing: ${manifestEntry.path}`);
      if (viewEntry.fingerprint !== manifestEntry.fingerprint) fail(`view fingerprint is stale for ${manifestEntry.id}`);
      if (viewEntry.previewStatus !== "missing" || !viewEntry.missing || viewEntry.content !== "") {
        fail(`view status is stale for ${manifestEntry.id}`);
      }
      if (
        DOCUMENT_FORMATS.binary.has(manifestEntry.format)
        && (viewEntry.previewFingerprint ?? null) !== (manifestEntry.previewFingerprint ?? null)
      ) {
        fail(`view preview fingerprint is stale for ${manifestEntry.id}`);
      }
      continue;
    }
    const bytes = await readFile(sourceStatus.absolutePath);
    const actualFingerprint = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (viewEntry.fingerprint !== actualFingerprint) fail(`view fingerprint is stale for ${manifestEntry.id}`);
    if (viewEntry.previewStatus === "stale") fail(`view status is stale for ${manifestEntry.id}`);
    if (DOCUMENT_FORMATS.text.has(manifestEntry.format)) {
      if (viewEntry.previewStatus !== "available" || viewEntry.missing) fail(`view status is stale for ${manifestEntry.id}`);
      const expectedContent = expectedTextContent(manifestEntry, bytes.toString("utf8"));
      if (viewEntry.content !== expectedContent) fail(`view content is stale for ${manifestEntry.id}`);
    } else {
      if (viewEntry.missing || viewEntry.previewStatus !== manifestEntry.previewStatus) {
        fail(`view status is stale for ${manifestEntry.id}`);
      }
      if ((viewEntry.previewFingerprint ?? null) !== (manifestEntry.previewFingerprint ?? null)) {
        fail(`view preview fingerprint is stale for ${manifestEntry.id}`);
      }
      if (viewEntry.previewStatus === "available") {
        if (!viewEntry.content) fail(`view status is stale for ${manifestEntry.id}`);
        const actualPreviewFingerprint = `sha256:${createHash("sha256").update(viewEntry.content).digest("hex")}`;
        if (actualPreviewFingerprint !== manifestEntry.previewFingerprint) {
          fail(`binary preview fingerprint is stale for ${manifestEntry.id}`);
        }
      } else if (viewEntry.content !== "") {
        fail(`view status is stale for ${manifestEntry.id}`);
      }
    }
  }
}

function validateManifestDocumentEntries(manifest) {
  const knownPageIds = new Set(manifest.pages.map((page) => page.id));
  const ids = new Set();
  const paths = new Set();
  for (const entry of manifest.documents) validateDocumentEntry(entry, knownPageIds, ids, paths);
  return ids;
}

async function validateDiscoveredDocumentInventory(projectRoot, manifest) {
  for (const entry of manifest.documents) {
    const source = await assertSafeProjectFile(
      projectRoot,
      entry.path,
      `document source ${entry.id}`,
      { allowMissing: true }
    );
    if (!source.exists && !entry.missing) {
      fail(`missing document must be explicitly marked missing: ${entry.path}`);
    }
    if (source.exists && entry.missing) fail(`document marked missing still exists: ${entry.path}`);
  }
  const discovered = await discoverDocuments({
    projectRoot,
    existingDocuments: manifest.documents
  });
  const existingByPath = new Map(manifest.documents.map((entry) => [entry.path, entry]));
  for (const current of discovered) {
    const recorded = existingByPath.get(current.path);
    if (!recorded) fail(`document inventory is incomplete: ${current.path}`);
    if (current.missing && !recorded.missing) {
      fail(`missing document must be explicitly marked missing: ${recorded.path}`);
    }
    if (!current.missing && recorded.missing) {
      fail(`document marked missing still exists: ${recorded.path}`);
    }
    if (!current.missing && current.fingerprint !== recorded.fingerprint) {
      fail(`document fingerprint is stale for ${recorded.id}`);
    }
    if (current.format !== recorded.format) fail(`document format is stale for ${recorded.id}`);
    if (recorded.associationSource !== "manual") {
      for (const field of ["kind", "pageIds", "associationSource", "evidence"]) {
        if (canonicalJson(current[field]) !== canonicalJson(recorded[field])) {
          fail(`document ${field} is stale for ${recorded.id}`);
        }
      }
    }
    const textStatusIsStale = DOCUMENT_FORMATS.text.has(recorded.format)
      && current.previewStatus !== recorded.previewStatus;
    if (current.missing !== recorded.missing || textStatusIsStale) {
      fail(`document status is stale for ${recorded.id}`);
    }
  }
}

async function validateManagedPrd(projectRoot, manifest, annotationByPage) {
  for (const page of manifest.pages) {
    const document = annotationByPage.get(page.id);
    if (page.managedPrdFile === undefined) {
      if (document.managedPrd !== null) fail(`annotation managedPrd requires page.managedPrdFile for ${page.id}`);
      continue;
    }
    assertProjectRelativePath(page.managedPrdFile, "page.managedPrdFile");
    const inventory = manifest.documents.find((entry) => entry.path === page.managedPrdFile);
    if (inventory?.managed !== true || inventory.kind !== "page-prd" || !inventory.pageIds.includes(page.id)) {
      fail(`managed PRD path is not Skill-created: ${page.managedPrdFile}`);
    }
    if (document.managedPrd === null) fail(`annotation managedPrd is required for ${page.id}`);
    const source = await readSafeText(projectRoot, page.managedPrdFile, `managed PRD ${page.id}`);
    if (source !== renderManagedPagePrd(document)) {
      fail(`managed PRD bytes are stale for ${page.id}`);
    }
  }
  if (manifest.managedTotalPrdFile !== undefined) {
    assertProjectRelativePath(manifest.managedTotalPrdFile, "managedTotalPrdFile");
    const inventory = manifest.documents.find((entry) => entry.path === manifest.managedTotalPrdFile);
    if (inventory?.managed !== true || inventory.kind !== "total-prd") {
      fail(`managed total PRD path is not Skill-created: ${manifest.managedTotalPrdFile}`);
    }
    const source = await readSafeText(projectRoot, manifest.managedTotalPrdFile, "managed total PRD");
    if (source !== renderManagedTotalPrd(manifest, manifest.managedTotalPrdFile)) {
      fail("managed total PRD bytes are stale");
    }
  }
}

function validatePageManifestIdentities(manifest) {
  for (const page of manifest.pages) {
    if (!PAGE_ID_PATTERN.test(page.id || "")) fail("Invalid page.id");
  }
}

function physicalEntries(manifest) {
  return manifest.pages
    .filter((page) => normalizePageIdentity(page).mode === "document")
    .sort((left, right) => (
      left.htmlPath < right.htmlPath ? -1 : left.htmlPath > right.htmlPath ? 1 : 0
    ));
}

async function validateRouteRegistries(projectRoot, manifest) {
  for (const basePage of physicalEntries(manifest)) {
    const html = await readSafeText(projectRoot, basePage.htmlPath, "HTML file");
    assertIntegration(projectRoot, manifest, basePage, html);
    if (!basePage.routeRegistryFile) continue;
    const source = await readSafeText(
      projectRoot,
      basePage.routeRegistryFile,
      "route registry file"
    );
    const registry = parseRouteRegistrySource(source, basePage.id);
    validateRouteRegistryIdentity(manifest, basePage, registry);
    if (!basePage.display.enabled) continue;
    const expected = serializeRouteRegistry(buildRouteRegistry({ manifest, basePage }));
    if (source !== expected) fail(`route registry is stale for ${basePage.id}`);
  }
}

export async function checkProject({ projectRoot } = {}) {
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const manifest = await readSafeJson(normalizedRoot, MANIFEST_PATH, "manifest");
  validateManifestV2(manifest);
  validatePageManifestIdentities(manifest);
  const sdkFile = await assertSafeProjectFile(normalizedRoot, SDK_PATH, "SDK file");
  const sdkBytes = await readFile(sdkFile.absolutePath);
  const sdkSha256 = createHash("sha256").update(sdkBytes).digest("hex");
  if (sdkSha256 !== manifest.project.sdk.sha256) fail("SDK SHA-256 does not match manifest");
  if (readSdkVersion(sdkBytes) !== manifest.project.sdk.version) {
    fail("SDK version banner does not match manifest");
  }

  const documentIds = validateManifestDocumentEntries(manifest);
  await validateRouteRegistries(normalizedRoot, manifest);
  const annotationByPage = new Map();
  let annotationCount = 0;
  for (const page of manifest.pages) {
    const annotation = await readSafeJson(normalizedRoot, page.annotationFile, "annotation file");
    validateCompleteAnnotationDocument(annotation, { documentIds });
    if (annotation.projectId !== manifest.project.id) fail("annotation projectId does not match manifest");
    if (annotation.page.id !== page.id) fail("annotation page.id does not match manifest");
    if (annotation.page.title !== page.title) fail("annotation page.title does not match manifest");
    if (annotation.page.htmlPath !== page.htmlPath) fail("annotation page.htmlPath does not match manifest");
    const pageIdentity = normalizePageIdentity(page);
    if (
      pageIdentity.mode === "hash-route"
      && annotation.page.route !== pageIdentity.routePattern
    ) {
      fail("annotation page.route does not match manifest route pattern");
    }
    annotationByPage.set(page.id, annotation);
    annotationCount += annotation.annotations.length;

    const viewSource = await readSafeText(normalizedRoot, page.viewFile, "view file");
    const view = parseViewSource(viewSource, page.id);
    if (view?.schemaVersion !== 2) fail(`view schemaVersion must be 2 for ${page.id}`);
    assertIsoTimestamp(view.generatedAt, `view generatedAt for ${page.id}`);
    if (view.projectId !== manifest.project.id) fail("view projectId does not match manifest");
    if (view.page?.id !== page.id) fail("view page.id does not match manifest");
    if (view.page?.title !== page.title) fail("view page.title does not match manifest");
    if (view.page?.htmlPath !== page.htmlPath) fail("view page.htmlPath does not match manifest");
    if (!FINGERPRINT_PATTERN.test(view.persistedAnnotationFingerprint || "")) {
      fail(`invalid persisted annotation fingerprint for ${page.id}`);
    }
    const permanentFingerprint = fingerprintValue(annotation.annotations);
    if (view.persistedAnnotationFingerprint !== permanentFingerprint) {
      fail(`persisted annotation fingerprint is stale for ${page.id}`);
    }
    if (canonicalJson(view.document) !== canonicalJson(annotation)) {
      fail(`view annotation document is stale for ${page.id}`);
    }
    await validateViewDocuments(normalizedRoot, page, view, manifest.documents);
  }
  await validateDiscoveredDocumentInventory(normalizedRoot, manifest);
  await validateManagedPrd(normalizedRoot, manifest, annotationByPage);
  return {
    pages: manifest.pages.length,
    annotations: annotationCount,
    documents: manifest.documents.length
  };
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--project-root" || !argv[1] || argv[1].startsWith("--")) {
    fail(USAGE);
  }
  return { projectRoot: argv[1] };
}

export async function runCheckProjectCli({ argv, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await checkProject(parseArguments(argv || []));
    stdout.write(
      `PRD Annotator gate passed: ${result.pages} pages, ${result.annotations} annotations, ${result.documents} documents\n`
    );
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runCheckProjectCli({ argv: process.argv.slice(2) });
}
