import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeProjectFile,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import { DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { relativeWebPath, upsertIntegration } from "./lib/html.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import { deriveProjectId } from "./lib/project.mjs";
import {
  applyProjectTransaction,
  assertProjectRelativePath,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import {
  OFFICIAL_REPOSITORY,
  resolveLatestRelease,
  validateReleaseInfo
} from "./lib/release.mjs";
import { assertValidRoute } from "./lib/route.mjs";
import {
  canonicalJson,
  normalizeAnnotationDocument,
  normalizePageIdentity,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildRouteRegistry, serializeRouteRegistry } from "./lib/route-registry.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";

const LEGACY_MANIFEST_PATH = "doc/prd/manifest.json";
const LEGACY_TOTAL_PRD_PATH = "doc/prd/PRD.md";
const V2_MANIFEST_PATH = ".prd-annotator/manifest.json";
const SDK_PATH = ".prd-annotator/sdk/prd-annotator.js";
const PAGE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const LEGACY_STATUSES = new Set(["open", "needs-clarification", "applied", "superseded"]);
const IMPACT_SCOPES = new Set(["page", "global"]);
const ANNOTATION_TYPES = new Set(["requirement", "change", "question", "bug"]);
const USAGE = "Usage: migrate-legacy.mjs --project-root PATH (--confirm-install | --confirm-upgrade) --confirm-migration";

function fail(message) {
  throw new Error(message);
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function legacyProjectIdentity(value, label) {
  const identities = [];
  for (const field of ["projectId", "projectKey"]) {
    if (!Object.hasOwn(value, field)) continue;
    if (typeof value[field] !== "string" || !PAGE_ID_PATTERN.test(value[field])) {
      fail(`Invalid legacy ${label} ${field}`);
    }
    identities.push(value[field]);
  }
  if (new Set(identities).size > 1) fail(`Conflicting legacy ${label} project identity`);
  return identities[0];
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readSafeBytes(projectRoot, relativePath, label, options) {
  const source = await assertSafeProjectFile(projectRoot, relativePath, label, options);
  if (!source.exists) return null;
  return readFile(source.absolutePath);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

async function readExistingV2(projectRoot) {
  const bytes = await readSafeBytes(projectRoot, V2_MANIFEST_PATH, "existing v2 manifest", { allowMissing: true });
  if (!bytes) return null;
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
    validateManifestV2(manifest);
  } catch (error) {
    fail(`Existing v2 manifest is invalid: ${error.message}`);
  }
  return { manifest, bytes };
}

function validateLegacyManifest(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.pages)) {
    fail("Invalid legacy manifest schema");
  }
  legacyProjectIdentity(value, "manifest");
  const ids = new Set();
  for (const [index, page] of value.pages.entries()) {
    if (!isRecord(page)) fail(`Invalid legacy page at index ${index}`);
    if (typeof page.id !== "string" || !page.id) fail(`Invalid legacy page id at index ${index}`);
    if (ids.has(page.id)) fail(`Duplicate legacy page id: ${page.id}`);
    ids.add(page.id);
    if (typeof page.title !== "string" || !page.title.trim()) fail(`Invalid legacy page title: ${page.id}`);
    for (const field of ["annotationFile", "prdFile"]) {
      try {
        assertProjectRelativePath(page[field], `legacy ${field}`);
      } catch {
        fail(`Invalid legacy ${field}`);
      }
    }
    if (page.htmlPath !== undefined) {
      try {
        assertProjectRelativePath(page.htmlPath, "legacy htmlPath");
      } catch {
        fail("Invalid legacy htmlPath");
      }
    }
    try {
      assertValidRoute(page.route, "legacy route");
    } catch {
      fail(`Invalid legacy route: ${page.id}`);
    }
  }
  return value;
}

function validIsoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateLegacyAnnotationDocument(document, legacyPage) {
  if (!isRecord(document) || document.schemaVersion !== 1 || !Array.isArray(document.annotations)) {
    fail(`Invalid legacy annotation schema: ${legacyPage.id}`);
  }
  if (!isRecord(document.page) || document.page.id !== legacyPage.id) {
    fail(`Legacy annotation page identity mismatch: ${legacyPage.id}`);
  }
  if (document.page.title !== legacyPage.title) {
    fail(`Legacy annotation page title mismatch: ${legacyPage.id}`);
  }
  if (document.page.route !== legacyPage.route) {
    fail(`Legacy annotation page route mismatch: ${legacyPage.id}`);
  }
  if (document.managedPrd !== undefined && document.managedPrd !== null) {
    fail(`Invalid legacy annotation managedPrd: ${legacyPage.id}`);
  }
  legacyProjectIdentity(document, `annotation ${legacyPage.id}`);
  const ids = new Set();
  for (const annotation of document.annotations) {
    const id = annotation?.id;
    const label = `legacy annotation ${id || "<missing>"}`;
    if (!isRecord(annotation) || typeof id !== "string" || !id || ids.has(id)) {
      fail(`Invalid or duplicate legacy annotation IDs: ${legacyPage.id}`);
    }
    ids.add(id);
    if (typeof annotation.comment !== "string" || !annotation.comment.trim()) fail(`Invalid ${label}.comment`);
    if (annotation.type !== undefined && !ANNOTATION_TYPES.has(annotation.type)) fail(`Invalid ${label}.type`);
    for (const field of ["title", "description", "prdContent"]) {
      if (annotation[field] !== undefined && (typeof annotation[field] !== "string" || !annotation[field].trim())) {
        fail(`Invalid ${label}.${field}`);
      }
    }
    for (const field of ["acceptanceCriteria", "dataFields", "apiPath", "edgeCases"]) {
      if (annotation[field] !== undefined && typeof annotation[field] !== "string") fail(`Invalid ${label}.${field}`);
    }
    if (!LEGACY_STATUSES.has(annotation.status)) fail(`Invalid ${label}.status`);
    if (!validIsoTimestamp(annotation.createdAt)) fail(`Invalid ${label}.createdAt`);
    if (!validIsoTimestamp(annotation.updatedAt) || Date.parse(annotation.updatedAt) < Date.parse(annotation.createdAt)) {
      fail(`Invalid ${label}.updatedAt`);
    }
    if (!isRecord(annotation.target)) fail(`Invalid ${label}.target`);
    for (const field of ["cssPath", "xpath", "textQuote"]) {
      if (typeof annotation.target[field] !== "string") fail(`Invalid ${label}.target.${field}`);
    }
    if (!isRecord(annotation.target.rect)) fail(`Invalid ${label}.target.rect`);
    for (const field of ["x", "y", "width", "height"]) {
      if (typeof annotation.target.rect[field] !== "number" || !Number.isFinite(annotation.target.rect[field])) {
        fail(`Invalid ${label}.target.rect.${field}`);
      }
    }
    if (annotation.target.rect.width < 0 || annotation.target.rect.height < 0) fail(`Invalid ${label}.target.rect dimensions`);
    if (!isRecord(annotation.prd)) fail(`Invalid ${label}.prd`);
    if (annotation.prd.linkedDocuments !== undefined
      && (!Array.isArray(annotation.prd.linkedDocuments)
        || annotation.prd.linkedDocuments.some((item) => typeof item !== "string" || !item.trim()))) {
      fail(`Invalid ${label}.prd.linkedDocuments`);
    }
    if (!Array.isArray(annotation.prd.linkedSections)
      || annotation.prd.linkedSections.some((section) => typeof section !== "string" || !section.trim())) {
      fail(`Invalid ${label}.prd.linkedSections`);
    }
    if (annotation.status === "applied" && annotation.prd.linkedSections.length === 0) {
      fail(`Invalid ${label}.prd.linkedSections`);
    }
    if (!IMPACT_SCOPES.has(annotation.prd.impactScope)) fail(`Invalid ${label}.prd.impactScope`);
    if (typeof annotation.prd.summary !== "string") fail(`Invalid ${label}.prd.summary`);
  }
  return document;
}

function cleanAscii(value, maxLength) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
}

function mappedPageId(originalId, index, usedIds, existingPage, htmlPath) {
  if (
    PAGE_ID_PATTERN.test(originalId)
    && (!usedIds.has(originalId) || (existingPage?.id === originalId && existingPage.htmlPath === htmlPath))
  ) {
    usedIds.add(originalId);
    return originalId;
  }
  const hash = createHash("sha256").update(`legacy-page:${originalId}:${index}`).digest("hex").slice(0, 8);
  const slug = cleanAscii(originalId, 23) || "legacy-page";
  let attempt = 1;
  while (true) {
    const suffix = attempt === 1 ? `-${hash}` : `-${hash}-${attempt}`;
    const candidate = `${slug.slice(0, 32 - suffix.length)}${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    attempt += 1;
  }
}

function legacyProjectPath(relativePath) {
  return `doc/prd/${relativePath}`;
}

async function resolveHtmlPath(projectRoot, legacyPage, existingManifest) {
  const existing = existingManifest?.pages.find((page) => page.id === legacyPage.id);
  const candidate = legacyPage.htmlPath || existing?.htmlPath || (() => {
    const routePath = legacyPage.route.replace(/^\/+/, "");
    return /\.html?$/i.test(routePath) ? routePath : null;
  })();
  if (!candidate) fail(`Legacy page ${legacyPage.id} requires an explicit htmlPath`);
  try {
    assertProjectRelativePath(candidate, "legacy htmlPath");
  } catch {
    fail("Invalid legacy htmlPath");
  }
  if (candidate === "doc/prd" || candidate.startsWith("doc/prd/")) {
    fail("Legacy htmlPath cannot be inside doc/prd");
  }
  await assertSafeProjectFile(projectRoot, candidate, `legacy HTML for ${legacyPage.id}`);
  return candidate;
}

function mergeUpgradeAnnotations(existing, legacy, page) {
  const normalizedLegacy = normalizeAnnotationDocument(legacy, {
    projectId: legacy.projectId,
    page
  });
  if (!existing) return normalizedLegacy;
  const result = normalizeAnnotationDocument(existing, {
    projectId: normalizedLegacy.projectId,
    page
  });
  result.schemaVersion = 2;
  result.projectId = normalizedLegacy.projectId;
  result.page = clone(page);
  result.managedPrd = existing.managedPrd ?? null;
  const byId = new Map(result.annotations.map((annotation) => [annotation.id, annotation]));
  const deletedIds = new Set(result.deletedAnnotations.map((annotation) => annotation.id));
  for (const annotation of normalizedLegacy.annotations) {
    if (deletedIds.has(annotation.id)) continue;
    if (byId.has(annotation.id)) {
      if (canonicalJson(byId.get(annotation.id)) !== canonicalJson(annotation)) {
        fail(`Legacy annotation ID collides with existing v2 annotation: ${annotation.id}`);
      }
    } else {
      result.annotations.push(annotation);
      byId.set(annotation.id, annotation);
    }
  }
  return result;
}

function verifyAnnotationParity(legacyIds, canonicalDocument, legacyPageId) {
  const canonicalIds = new Set(canonicalDocument.annotations.map((annotation) => annotation.id));
  for (const annotation of canonicalDocument.deletedAnnotations || []) {
    canonicalIds.add(annotation.id);
  }
  const missing = legacyIds.filter((id) => !canonicalIds.has(id));
  if (missing.length) fail(`Migration annotation ID parity failed for ${legacyPageId}: ${missing.join(", ")}`);
}

function manualPrdEntry(entry, { kind, pageIds }) {
  return {
    ...entry,
    kind,
    pageIds,
    associationSource: "manual",
    evidence: kind === "total-prd"
      ? ["Legacy project-level PRD retained at original path"]
      : ["Legacy page PRD retained at original path"]
  };
}

const PRD_FORMAT_BY_EXTENSION = Object.freeze({
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".pdf": "pdf",
  ".docx": "docx"
});

function explicitPrdFormat(relativePath) {
  return PRD_FORMAT_BY_EXTENSION[path.posix.extname(relativePath).toLowerCase()] || "text";
}

function explicitDocumentId(relativePath) {
  return `doc-${createHash("sha256").update(relativePath).digest("hex").slice(0, 10)}`;
}

function validateDocumentInventoryUniqueness(documents, label) {
  const ids = new Set();
  const paths = new Set();
  for (const entry of documents) {
    if (typeof entry?.id !== "string" || !entry.id.trim()) fail(`Invalid ${label} document ID`);
    if (ids.has(entry.id)) fail(`Duplicate ${label} document ID: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.path !== "string" || !entry.path.trim()) fail(`Invalid ${label} document path`);
    if (paths.has(entry.path)) fail(`Duplicate ${label} document path: ${entry.path}`);
    paths.add(entry.path);
  }
  return { ids, paths };
}

function allocateExplicitDocumentId(relativePath, usedIds) {
  const base = explicitDocumentId(relativePath);
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let attempt = 2;
  while (usedIds.has(`${base}-${attempt}`)) attempt += 1;
  const candidate = `${base}-${attempt}`;
  usedIds.add(candidate);
  return candidate;
}

function explicitPrdTitle(relativePath, bytes, fallback) {
  const format = explicitPrdFormat(relativePath);
  if (DOCUMENT_FORMATS.text.has(format)) {
    const heading = /^\s*#\s+(.+?)\s*$/m.exec(bytes.toString("utf8"))?.[1]?.trim();
    if (heading) return heading;
  }
  return fallback;
}

function explicitPrdEntry(relativePath, bytes, existing, { kind, pageIds, fallbackTitle, documentId }) {
  const format = explicitPrdFormat(relativePath);
  const entry = manualPrdEntry({
    ...(existing ? clone(existing) : {}),
    id: existing?.id || documentId || explicitDocumentId(relativePath),
    path: relativePath,
    title: existing?.title || explicitPrdTitle(relativePath, bytes, fallbackTitle),
    format,
    fingerprint: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    previewStatus: DOCUMENT_FORMATS.text.has(format) ? "available" : "unavailable",
    missing: false
  }, { kind, pageIds });
  if (DOCUMENT_FORMATS.binary.has(format)) entry.previewFingerprint = null;
  else delete entry.previewFingerprint;
  return entry;
}

async function inventoryDocuments(projectRoot, existingDocuments, legacyPages, pageIdMap) {
  const documents = clone(existingDocuments);
  const { ids: usedIds } = validateDocumentInventoryUniqueness(documents, "existing v2");
  const explicitSources = new Map();
  const pagePrdByPath = new Map();
  for (const page of legacyPages) {
    const relativePath = legacyProjectPath(page.prdFile);
    const pageIds = pagePrdByPath.get(relativePath) || [];
    pageIds.push(pageIdMap instanceof Map ? pageIdMap.get(page.id) : pageIdMap[page.id]);
    pagePrdByPath.set(relativePath, pageIds);
  }
  const definitions = [
    ...legacyPages.map((page) => ({
      relativePath: legacyProjectPath(page.prdFile),
      kind: "page-prd",
      pageIds: pagePrdByPath.get(legacyProjectPath(page.prdFile)),
      fallbackTitle: page.title
    })),
    {
      relativePath: LEGACY_TOTAL_PRD_PATH,
      kind: "total-prd",
      pageIds: [],
      fallbackTitle: "Product Requirements"
    }
  ];
  const seen = new Set();
  for (const definition of definitions) {
    if (seen.has(definition.relativePath)) continue;
    seen.add(definition.relativePath);
    const source = await assertSafeProjectFile(projectRoot, definition.relativePath, "legacy PRD source");
    const bytes = await readFile(source.absolutePath);
    explicitSources.set(definition.relativePath, bytes);
    const existingIndex = documents.findIndex((entry) => entry.path === definition.relativePath);
    const entry = explicitPrdEntry(
      definition.relativePath,
      bytes,
      existingIndex >= 0 ? documents[existingIndex] : null,
      {
        ...definition,
        documentId: existingIndex >= 0 ? undefined : allocateExplicitDocumentId(definition.relativePath, usedIds)
      }
    );
    if (existingIndex >= 0) documents[existingIndex] = entry;
    else documents.push(entry);
  }
  validateDocumentInventoryUniqueness(documents, "migrated");
  return { documents, explicitSources };
}

function parseViewSource(source) {
  const prefix = [
    "window.PRDAnnotator.registerView(",
    "window.PRDAnnotator.hydrateView("
  ].find((candidate) => source.startsWith(candidate));
  const suffix = ");\n";
  if (!prefix || !source.endsWith(suffix)) return null;
  try {
    return JSON.parse(source.slice(prefix.length, -suffix.length));
  } catch {
    return null;
  }
}

function physicalEntries(manifest) {
  return manifest.pages
    .filter((page) => normalizePageIdentity(page).mode === "document")
    .sort((left, right) => (
      left.htmlPath < right.htmlPath ? -1 : left.htmlPath > right.htmlPath ? 1 : 0
    ));
}

async function buildPreviews(projectRoot, documents, existingManifest, explicitSources, retainedViewBytes) {
  const previews = {};
  for (const page of existingManifest?.pages || []) {
    const bytes = retainedViewBytes.get(page.viewFile);
    if (!bytes) continue;
    const view = parseViewSource(bytes.toString("utf8"));
    for (const entry of view?.documents || []) {
      if (entry.previewStatus === "available" && typeof entry.content === "string") previews[entry.path] = entry.content;
    }
  }
  for (const [relativePath, bytes] of explicitSources) {
    const entry = documents.find((candidate) => candidate.path === relativePath);
    if (!entry?.missing && DOCUMENT_FORMATS.text.has(entry.format)) previews[relativePath] = bytes.toString("utf8");
  }
  return previews;
}

async function resolveSdkRelease(releaseClient, timestamp) {
  if (!releaseClient || typeof releaseClient.getLatestRelease !== "function") {
    fail("releaseClient.getLatestRelease is required");
  }
  const releaseInfo = validateReleaseInfo(await releaseClient.getLatestRelease());
  return {
    sdkBytes: releaseInfo.sdkBuffer,
    sdk: {
      version: releaseInfo.version,
      releaseUrl: releaseInfo.releaseUrl,
      sha256: releaseInfo.sha256,
      installedAt: timestamp
    }
  };
}

async function inspectOrphanedV2Artifacts(projectRoot) {
  const sdkBytes = await readSafeBytes(projectRoot, SDK_PATH, "orphan SDK", { allowMissing: true });
  let hasDataOrViewArtifacts = false;
  for (const relativePath of [".prd-annotator/data", ".prd-annotator/view"]) {
    const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
    if (await pathStatus(absolutePath)) hasDataOrViewArtifacts = true;
  }
  return { sdkBytes, hasDataOrViewArtifacts };
}

async function migrateLegacyLocked({ projectRoot, authorization, now, transactionHooks, releaseClient }) {
  const sourceBytes = await readSafeBytes(projectRoot, LEGACY_MANIFEST_PATH, "legacy manifest");
  const legacyManifest = validateLegacyManifest(parseJson(sourceBytes, "legacy manifest"));
  const existing = await readExistingV2(projectRoot);
  const orphanedV2 = existing
    ? { sdkBytes: null, hasDataOrViewArtifacts: false }
    : await inspectOrphanedV2Artifacts(projectRoot);
  if (authorization === "install" && existing) fail("existing v2 installation requires upgrade authorization");
  if (authorization === "install" && orphanedV2.sdkBytes) {
    fail("An orphan SDK requires explicit upgrade recovery authorization");
  }
  if (authorization === "install" && orphanedV2.hasDataOrViewArtifacts) {
    fail("Existing v2 artifacts require upgrade or recovery");
  }
  if (
    authorization === "upgrade"
    && !existing
    && (!orphanedV2.sdkBytes || orphanedV2.hasDataOrViewArtifacts)
  ) fail("upgrade authorization requires an existing valid v2 installation or isolated orphan SDK");
  const existingManifest = existing?.manifest || null;
  const suppliedManifestProjectId = legacyProjectIdentity(legacyManifest, "manifest");
  if (
    existingManifest
    && suppliedManifestProjectId
    && suppliedManifestProjectId !== existingManifest.project.id
  ) fail("Legacy project identity conflicts with existing v2 project");
  const timestamp = normalizeNow(now);
  const usedIds = new Set(existingManifest?.pages.map((page) => page.id) || []);
  const pageIdMap = new Map();
  const pagePlans = [];
  const htmlPaths = new Set(existingManifest?.pages.map((page) => page.htmlPath) || []);

  for (const [index, legacyPage] of legacyManifest.pages.entries()) {
    const annotationRelativePath = legacyProjectPath(legacyPage.annotationFile);
    const prdRelativePath = legacyProjectPath(legacyPage.prdFile);
    let annotationBytes;
    try {
      annotationBytes = await readSafeBytes(projectRoot, annotationRelativePath, "legacy annotationFile");
    } catch (error) {
      if (error.message.includes("does not exist")) fail(`Legacy annotation file does not exist: ${annotationRelativePath}`);
      throw error;
    }
    await assertSafeProjectFile(projectRoot, prdRelativePath, "legacy prdFile");
    const legacyAnnotation = parseJson(annotationBytes, `legacy annotation ${legacyPage.id}`);
    validateLegacyAnnotationDocument(legacyAnnotation, legacyPage);
    const htmlPath = await resolveHtmlPath(projectRoot, legacyPage, existingManifest);
    if (legacyAnnotation.page.htmlPath !== undefined && legacyAnnotation.page.htmlPath !== htmlPath) {
      fail(`Legacy annotation page htmlPath mismatch: ${legacyPage.id}`);
    }
    const suppliedAnnotationProjectId = legacyProjectIdentity(legacyAnnotation, `annotation ${legacyPage.id}`);
    if (existingManifest && suppliedAnnotationProjectId && suppliedAnnotationProjectId !== existingManifest.project.id) {
      fail("Legacy project identity conflicts with existing v2 project");
    }
    if (
      suppliedAnnotationProjectId
      && suppliedManifestProjectId
      && suppliedAnnotationProjectId !== suppliedManifestProjectId
    ) {
      fail(`Legacy annotation projectId mismatch: ${legacyPage.id}`);
    }
    const collidingExistingPage = existingManifest?.pages.find((page) => page.id === legacyPage.id);
    let existingPage = null;
    let existingDocument = null;
    let existingDocumentBytes = null;
    if (collidingExistingPage) {
      if (collidingExistingPage.htmlPath !== htmlPath) {
        fail(`Legacy page HTML path conflicts with existing v2 page: ${legacyPage.id}`);
      }
      if (collidingExistingPage.title !== legacyPage.title) {
        fail(`Legacy page title conflicts with existing v2 page: ${legacyPage.id}`);
      }
      existingDocumentBytes = await readSafeBytes(
        projectRoot,
        collidingExistingPage.annotationFile,
        `existing annotation for ${collidingExistingPage.id}`
      );
      existingDocument = parseJson(existingDocumentBytes, `existing annotation for ${collidingExistingPage.id}`);
      validateCompleteAnnotationDocument(existingDocument, { label: `existing annotation ${collidingExistingPage.id}` });
      if (
        existingDocument.projectId !== existingManifest.project.id
        || existingDocument.page?.id !== collidingExistingPage.id
        || existingDocument.page?.title !== collidingExistingPage.title
        || existingDocument.page?.htmlPath !== collidingExistingPage.htmlPath
      ) fail(`Existing v2 page identity is invalid: ${collidingExistingPage.id}`);
      if (existingDocument.page.route !== legacyPage.route) {
        fail(`Legacy page route conflicts with existing v2 page: ${legacyPage.id}`);
      }
      existingPage = collidingExistingPage;
    }
    const pageId = mappedPageId(legacyPage.id, index, usedIds, collidingExistingPage, htmlPath);
    if (htmlPaths.has(htmlPath) && existingPage?.htmlPath !== htmlPath) fail(`Duplicate legacy HTML path: ${htmlPath}`);
    htmlPaths.add(htmlPath);
    pageIdMap.set(legacyPage.id, pageId);
    const finalPage = {
      ...clone(existingPage || {}),
      id: pageId,
      title: legacyPage.title,
      htmlPath,
      annotationFile: `.prd-annotator/data/pages/${pageId}.json`,
      viewFile: `.prd-annotator/view/pages/${pageId}.js`,
      display: { enabled: true, updatedAt: timestamp }
    };
    const pageIdentity = {
      id: pageId,
      title: finalPage.title,
      htmlPath,
      route: legacyPage.route
    };
    const normalized = normalizeAnnotationDocument(legacyAnnotation, {
      projectId: existingManifest?.project.id || suppliedManifestProjectId || suppliedAnnotationProjectId || "pending-project",
      page: pageIdentity
    });
    normalized.projectId = existingManifest?.project.id || suppliedManifestProjectId || suppliedAnnotationProjectId || "pending-project";
    normalized.page = clone(pageIdentity);
    normalized.managedPrd = null;
    delete normalized.projectKey;
    const legacyIds = legacyAnnotation.annotations.map((annotation) => annotation?.id);
    if (legacyIds.some((id) => typeof id !== "string" || !id) || new Set(legacyIds).size !== legacyIds.length) {
      fail(`Invalid or duplicate legacy annotation IDs: ${legacyPage.id}`);
    }
    pagePlans.push({
      legacyPage,
      finalPage,
      normalized,
      legacyIds,
      htmlPath,
      existingDocument,
      existingDocumentBytes,
      sourceProjectId: suppliedAnnotationProjectId
    });
  }

  const sourceProjectIds = new Set(pagePlans.map((plan) => plan.sourceProjectId).filter(Boolean));
  if (sourceProjectIds.size > 1) fail("Legacy annotation projectIds do not match");
  const projectId = existingManifest?.project.id
    || suppliedManifestProjectId
    || [...sourceProjectIds][0]
    || deriveProjectId(path.basename(projectRoot), projectRoot);
  const sdkBeforeImage = existing
    ? await readSafeBytes(projectRoot, SDK_PATH, "existing SDK", { allowMissing: true })
    : orphanedV2.sdkBytes;
  const { sdk, sdkBytes } = await resolveSdkRelease(releaseClient, timestamp);
  const pages = clone(existingManifest?.pages || []);
  const annotationByPage = new Map();
  for (const plan of pagePlans) {
    plan.normalized.projectId = projectId;
    let existingDocument = plan.existingDocument;
    const existingPage = existingManifest?.pages.find((page) => page.id === plan.finalPage.id);
    if (existingPage && !existingDocument) {
      plan.existingDocumentBytes = await readSafeBytes(
        projectRoot,
        existingPage.annotationFile,
        `existing annotation for ${existingPage.id}`
      );
      existingDocument = parseJson(plan.existingDocumentBytes, `existing annotation for ${existingPage.id}`);
    }
    const canonical = mergeUpgradeAnnotations(existingDocument, plan.normalized, {
      id: plan.finalPage.id,
      title: plan.finalPage.title,
      htmlPath: plan.finalPage.htmlPath,
      route: plan.normalized.page.route
    });
    canonical.projectId = projectId;
    validateCompleteAnnotationDocument(canonical, { label: `migrated annotation ${plan.legacyPage.id}` });
    verifyAnnotationParity(plan.legacyIds, canonical, plan.legacyPage.id);
    annotationByPage.set(plan.finalPage.id, canonical);
    const existingIndex = pages.findIndex((page) => page.id === plan.finalPage.id);
    if (existingIndex >= 0) pages[existingIndex] = plan.finalPage;
    else pages.push(plan.finalPage);
  }

  const { documents, explicitSources } = await inventoryDocuments(
    projectRoot,
    existingManifest?.documents || [],
    legacyManifest.pages,
    pageIdMap
  );
  const serializedPageIdMap = Object.fromEntries(
    [...pageIdMap].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  );
  const migration = {
    ...clone(existingManifest?.migration || {}),
    source: LEGACY_MANIFEST_PATH,
    migratedAt: timestamp,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    pageIdParityVerified: true,
    pageIdMap: serializedPageIdMap
  };
  const nextManifest = {
    schemaVersion: 2,
    project: { id: projectId, sdk },
    pages,
    documents,
    migration
  };
  if (existingManifest?.managedTotalPrdFile) nextManifest.managedTotalPrdFile = existingManifest.managedTotalPrdFile;
  validateManifestV2(nextManifest);
  const documentIds = new Set(documents.map((entry) => entry.id));
  for (const document of annotationByPage.values()) {
    validateCompleteAnnotationDocument(document, { label: `migrated annotation ${document.page.id}`, documentIds });
  }

  for (const page of pages) {
    if (annotationByPage.has(page.id)) continue;
    annotationByPage.set(page.id, parseJson(
      await readSafeBytes(projectRoot, page.annotationFile, `existing annotation for ${page.id}`),
      `existing annotation for ${page.id}`
    ));
  }
  const existingViewPaths = new Set(existingManifest?.pages.map((page) => page.viewFile) || []);
  const viewBeforeImages = new Map();
  for (const page of pages) {
    viewBeforeImages.set(
      page.viewFile,
      existingViewPaths.has(page.viewFile)
        ? await readSafeBytes(projectRoot, page.viewFile, `existing view ${page.id}`, { allowMissing: true })
        : null
    );
  }
  const previews = await buildPreviews(projectRoot, documents, existingManifest, explicitSources, viewBeforeImages);
  const viewSources = new Map();
  for (const page of pages) {
    viewSources.set(page.viewFile, serializeViewBundle(buildViewBundle({
      manifest: nextManifest,
      page,
      annotationDocument: annotationByPage.get(page.id),
      documents,
      previews,
      generatedAt: timestamp
    })));
  }
  const routeRegistrySources = new Map();
  const routeRegistryBeforeImages = new Map();
  for (const basePage of physicalEntries(nextManifest)) {
    if (!basePage.routeRegistryFile) continue;
    routeRegistryBeforeImages.set(
      basePage.routeRegistryFile,
      await readSafeBytes(
        projectRoot,
        basePage.routeRegistryFile,
        `existing route registry ${basePage.id}`,
        { allowMissing: true }
      )
    );
    routeRegistrySources.set(
      basePage.routeRegistryFile,
      serializeRouteRegistry(buildRouteRegistry({ manifest: nextManifest, basePage }))
    );
  }
  const htmlSources = new Map();
  const htmlBeforeImages = new Map();
  const migratedHtmlPaths = new Set(pagePlans.map((plan) => plan.htmlPath));
  for (const basePage of physicalEntries(nextManifest).filter((page) => migratedHtmlPaths.has(page.htmlPath))) {
    const htmlPath = (await assertSafeProjectFile(projectRoot, basePage.htmlPath, "legacy HTML")).absolutePath;
    const htmlBytes = await readFile(htmlPath);
    htmlBeforeImages.set(basePage.htmlPath, htmlBytes);
    htmlSources.set(basePage.htmlPath, upsertIntegration(htmlBytes.toString("utf8"), {
      src: relativeWebPath(basePage.htmlPath, SDK_PATH),
      projectId,
      pageId: basePage.id,
      viewSrc: relativeWebPath(basePage.htmlPath, basePage.viewFile),
      routeSrc: basePage.routeRegistryFile
        ? relativeWebPath(basePage.htmlPath, basePage.routeRegistryFile)
        : undefined
    }));
  }
  const annotationSources = new Map(pagePlans.map((plan) => [
    plan.finalPage.annotationFile,
    Buffer.from(`${JSON.stringify(annotationByPage.get(plan.finalPage.id), null, 2)}\n`)
  ]));
  const annotationBeforeImages = new Map(pagePlans.map((plan) => [
    plan.finalPage.annotationFile,
    plan.existingDocumentBytes
  ]));
  const operations = [
    makeProjectOperation(projectRoot, SDK_PATH, sdkBytes, { expectedBeforeImage: sdkBeforeImage }),
    ...[...annotationSources].map(([relativePath, source]) => makeProjectOperation(
      projectRoot,
      relativePath,
      source,
      { expectedBeforeImage: annotationBeforeImages.get(relativePath) ?? null }
    )),
    ...[...viewSources].map(([relativePath, source]) => makeProjectOperation(
      projectRoot,
      relativePath,
      source,
      { expectedBeforeImage: viewBeforeImages.get(relativePath) }
    )),
    ...[...routeRegistrySources].map(([relativePath, source]) => makeProjectOperation(
      projectRoot,
      relativePath,
      source,
      { expectedBeforeImage: routeRegistryBeforeImages.get(relativePath) }
    )),
    ...[...htmlSources].map(([relativePath, source]) => makeProjectOperation(
      projectRoot,
      relativePath,
      source,
      { expectedBeforeImage: htmlBeforeImages.get(relativePath) }
    )),
    makeProjectOperation(
      projectRoot,
      V2_MANIFEST_PATH,
      `${JSON.stringify(nextManifest, null, 2)}\n`,
      { expectedBeforeImage: existing?.bytes ?? null }
    )
  ];
  await applyProjectTransaction({
    projectRoot,
    operations,
    transactionHooks,
    verify: async () => {
      const installedSdk = await readSafeBytes(projectRoot, SDK_PATH, "migrated SDK");
      if (!installedSdk.equals(sdkBytes)) fail("Migrated SDK verification failed");
      const installedBytes = await readSafeBytes(projectRoot, V2_MANIFEST_PATH, "migrated manifest");
      if (canonicalJson(parseJson(installedBytes, "migrated manifest")) !== canonicalJson(nextManifest)) {
        fail("Migrated manifest verification failed");
      }
      for (const plan of pagePlans) {
        const installed = await readSafeBytes(
          projectRoot,
          plan.finalPage.annotationFile,
          `migrated annotation ${plan.finalPage.id}`
        );
        if (!installed.equals(annotationSources.get(plan.finalPage.annotationFile))) {
          fail(`Migrated annotation verification failed: ${plan.finalPage.id}`);
        }
        const canonical = parseJson(installed, `migrated annotation ${plan.finalPage.id}`);
        verifyAnnotationParity(plan.legacyIds, canonical, plan.legacyPage.id);
      }
      for (const [relativePath, source] of viewSources) {
        const installed = await readSafeBytes(projectRoot, relativePath, `migrated view ${relativePath}`);
        if (!installed.equals(Buffer.from(source))) fail(`Migrated view verification failed: ${relativePath}`);
      }
      for (const [relativePath, source] of routeRegistrySources) {
        const installed = await readSafeBytes(projectRoot, relativePath, `migrated route registry ${relativePath}`);
        if (!installed.equals(Buffer.from(source))) {
          fail(`Migrated route registry verification failed: ${relativePath}`);
        }
      }
      for (const [relativePath, source] of htmlSources) {
        const installed = await readSafeBytes(projectRoot, relativePath, `migrated HTML ${relativePath}`);
        if (!installed.equals(Buffer.from(source))) fail(`Migrated HTML verification failed: ${relativePath}`);
      }
    }
  });
  return nextManifest;
}

export async function migrateLegacy({
  projectRoot,
  authorization,
  confirmMigration,
  now,
  transactionHooks = {},
  projectLock,
  projectLockOptions = {},
  onWarning,
  releaseClient
} = {}) {
  if (confirmMigration !== true) fail("--confirm-migration is required");
  if (authorization !== "install" && authorization !== "upgrade") {
    fail("authorized install or upgrade is required");
  }
  if (
    !transactionHooks
    || typeof transactionHooks !== "object"
    || (transactionHooks.afterCommit !== undefined && typeof transactionHooks.afterCommit !== "function")
    || (transactionHooks.beforeRollbackOperation !== undefined
      && typeof transactionHooks.beforeRollbackOperation !== "function")
  ) fail("Invalid transactionHooks");
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  return withProjectMutationLock(
    normalizedRoot,
    () => migrateLegacyLocked({
      projectRoot: normalizedRoot,
      authorization,
      now,
      transactionHooks,
      releaseClient
    }),
    { lease: projectLock, lockOptions: projectLockOptions, onWarning }
  );
}

function parseArguments(argv) {
  let projectRoot;
  let confirmMigration = false;
  let install = false;
  let upgrade = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project-root") {
      if (projectRoot !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) fail(USAGE);
      projectRoot = argv[index + 1];
      index += 1;
    } else if (argument === "--confirm-migration") {
      if (confirmMigration) fail(USAGE);
      confirmMigration = true;
    } else if (argument === "--confirm-install") {
      if (install) fail(USAGE);
      install = true;
    } else if (argument === "--confirm-upgrade") {
      if (upgrade) fail(USAGE);
      upgrade = true;
    } else fail(USAGE);
  }
  if (!projectRoot) fail(USAGE);
  if (install === upgrade) fail("exactly one of --confirm-install or --confirm-upgrade is required");
  return { projectRoot, authorization: install ? "install" : "upgrade", confirmMigration };
}

export async function runMigrateLegacyCli({
  argv,
  now,
  releaseClient,
  transactionHooks,
  projectLockOptions,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  try {
    const manifest = await migrateLegacy({
      ...parseArguments(argv || []),
      now,
      releaseClient: releaseClient || {
        getLatestRelease: () => resolveLatestRelease({ fetchImpl: fetch, repository: OFFICIAL_REPOSITORY })
      },
      transactionHooks,
      projectLockOptions,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`)
    });
    stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runMigrateLegacyCli({ argv: process.argv.slice(2) });
}
