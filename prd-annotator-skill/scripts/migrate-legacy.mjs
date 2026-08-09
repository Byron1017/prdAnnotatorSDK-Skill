import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeProjectFile,
  checkProject,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import { discoverDocuments, DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { relativeWebPath, upsertIntegration } from "./lib/html.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import { deriveProjectId } from "./lib/project.mjs";
import {
  applyProjectTransaction,
  assertProjectRelativePath,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import { readSdkVersion, sha256 } from "./lib/release.mjs";
import {
  canonicalJson,
  normalizeAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";

const LEGACY_MANIFEST_PATH = "doc/prd/manifest.json";
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
    if (typeof page.route !== "string" || !page.route.startsWith("/")) fail(`Invalid legacy route: ${page.id}`);
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
  if (!existing) return legacy;
  const result = clone(existing);
  result.schemaVersion = 2;
  result.projectId = legacy.projectId;
  result.page = clone(page);
  result.managedPrd = existing.managedPrd ?? null;
  const byId = new Map(result.annotations.map((annotation) => [annotation.id, annotation]));
  for (const annotation of legacy.annotations) {
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

async function inventoryDocuments(projectRoot, existingDocuments, legacyPages, pageIdMap) {
  let documents = await discoverDocuments({ projectRoot, existingDocuments });
  const pagePrdByPath = new Map();
  for (const page of legacyPages) {
    const relativePath = legacyProjectPath(page.prdFile);
    const pageIds = pagePrdByPath.get(relativePath) || [];
    pageIds.push(pageIdMap[page.id]);
    pagePrdByPath.set(relativePath, pageIds);
  }
  documents = documents.map((entry) => {
    if (pagePrdByPath.has(entry.path)) {
      return manualPrdEntry(entry, { kind: "page-prd", pageIds: pagePrdByPath.get(entry.path) });
    }
    if (entry.path === "doc/prd/PRD.md") return manualPrdEntry(entry, { kind: "total-prd", pageIds: [] });
    return entry;
  });
  return documents;
}

function parseViewSource(source) {
  const prefix = "window.PRDAnnotator.hydrateView(";
  const suffix = ");\n";
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null;
  try {
    return JSON.parse(source.slice(prefix.length, -suffix.length));
  } catch {
    return null;
  }
}

async function buildPreviews(projectRoot, documents, existingManifest) {
  const previews = {};
  for (const page of existingManifest?.pages || []) {
    const sourceFile = await assertSafeProjectFile(projectRoot, page.viewFile, "existing view", { allowMissing: true });
    if (!sourceFile.exists) continue;
    const view = parseViewSource(await readFile(sourceFile.absolutePath, "utf8"));
    for (const entry of view?.documents || []) {
      if (entry.previewStatus === "available" && entry.content) previews[entry.path] = entry.content;
    }
  }
  for (const entry of documents) {
    if (entry.missing || !DOCUMENT_FORMATS.text.has(entry.format)) continue;
    const source = await assertSafeProjectFile(projectRoot, entry.path, `document source ${entry.id}`);
    previews[entry.path] = await readFile(source.absolutePath, "utf8");
  }
  return previews;
}

async function installSdkMetadata(projectRoot, existingManifest, timestamp) {
  if (existingManifest) return clone(existingManifest.project.sdk);
  const sdkBytes = await readSafeBytes(projectRoot, SDK_PATH, "installed SDK");
  const version = readSdkVersion(sdkBytes);
  return {
    version,
    releaseUrl: `https://github.com/Byron1017/prdAnnotatorSDK-Skill/releases/tag/v${version}`,
    sha256: sha256(sdkBytes),
    installedAt: timestamp
  };
}

async function hasOrphanedV2Artifacts(projectRoot) {
  for (const relativePath of [".prd-annotator/data", ".prd-annotator/view"]) {
    const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
    if (await pathStatus(absolutePath)) return true;
  }
  return false;
}

async function migrateLegacyLocked({ projectRoot, authorization, now, transactionHooks }) {
  const sourceBytes = await readSafeBytes(projectRoot, LEGACY_MANIFEST_PATH, "legacy manifest");
  const legacyManifest = validateLegacyManifest(parseJson(sourceBytes, "legacy manifest"));
  const existing = await readExistingV2(projectRoot);
  if (authorization === "install" && existing) fail("existing v2 installation requires upgrade authorization");
  if (authorization === "install" && !existing && await hasOrphanedV2Artifacts(projectRoot)) {
    fail("Existing v2 artifacts require upgrade or recovery");
  }
  if (authorization === "upgrade" && !existing) fail("upgrade authorization requires an existing valid v2 installation");
  const existingManifest = existing?.manifest || null;
  const timestamp = normalizeNow(now);
  const usedIds = new Set(existingManifest?.pages.map((page) => page.id) || []);
  const pageIdMap = {};
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
    if (legacyAnnotation.projectId !== undefined
      && (typeof legacyAnnotation.projectId !== "string" || !legacyAnnotation.projectId)) {
      fail(`Invalid legacy annotation projectId: ${legacyPage.id}`);
    }
    const authoritativeProjectId = existingManifest?.project.id || legacyManifest.projectId;
    if (legacyAnnotation.projectId !== undefined
      && authoritativeProjectId !== undefined
      && legacyAnnotation.projectId !== authoritativeProjectId) {
      fail(`Legacy annotation projectId mismatch: ${legacyPage.id}`);
    }
    const collidingExistingPage = existingManifest?.pages.find((page) => page.id === legacyPage.id);
    const existingPage = collidingExistingPage?.htmlPath === htmlPath ? collidingExistingPage : null;
    const pageId = mappedPageId(legacyPage.id, index, usedIds, collidingExistingPage, htmlPath);
    if (htmlPaths.has(htmlPath) && existingPage?.htmlPath !== htmlPath) fail(`Duplicate legacy HTML path: ${htmlPath}`);
    htmlPaths.add(htmlPath);
    pageIdMap[legacyPage.id] = pageId;
    const finalPage = {
      id: pageId,
      title: existingPage?.title || legacyPage.title,
      htmlPath,
      annotationFile: `.prd-annotator/data/pages/${pageId}.json`,
      viewFile: `.prd-annotator/view/pages/${pageId}.js`,
      display: { enabled: true, updatedAt: timestamp }
    };
    if (existingPage?.managedPrdFile) finalPage.managedPrdFile = existingPage.managedPrdFile;
    const pageIdentity = {
      id: pageId,
      title: finalPage.title,
      htmlPath,
      route: `/${htmlPath}`
    };
    const normalized = normalizeAnnotationDocument(legacyAnnotation, {
      projectId: existingManifest?.project.id || legacyManifest.projectId || "pending-project",
      page: pageIdentity
    });
    normalized.projectId = existingManifest?.project.id || legacyManifest.projectId || "pending-project";
    normalized.page = clone(pageIdentity);
    normalized.managedPrd = null;
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
      sourceProjectId: legacyAnnotation.projectId
    });
  }

  const sourceProjectIds = new Set(pagePlans.map((plan) => plan.sourceProjectId).filter(Boolean));
  if (sourceProjectIds.size > 1) fail("Legacy annotation projectIds do not match");
  const projectId = existingManifest?.project.id
    || legacyManifest.projectId
    || [...sourceProjectIds][0]
    || deriveProjectId(path.basename(projectRoot), projectRoot);
  const sdk = await installSdkMetadata(projectRoot, existingManifest, timestamp);
  const pages = clone(existingManifest?.pages || []);
  const annotationByPage = new Map();
  for (const plan of pagePlans) {
    plan.normalized.projectId = projectId;
    let existingDocument = null;
    const existingPage = existingManifest?.pages.find((page) => page.id === plan.finalPage.id);
    if (existingPage) {
      existingDocument = parseJson(
        await readSafeBytes(projectRoot, existingPage.annotationFile, `existing annotation for ${existingPage.id}`),
        `existing annotation for ${existingPage.id}`
      );
    }
    const canonical = mergeUpgradeAnnotations(existingDocument, plan.normalized, {
      id: plan.finalPage.id,
      title: plan.finalPage.title,
      htmlPath: plan.finalPage.htmlPath,
      route: `/${plan.finalPage.htmlPath}`
    });
    canonical.projectId = projectId;
    validateCompleteAnnotationDocument(canonical, { label: `migrated annotation ${plan.legacyPage.id}` });
    verifyAnnotationParity(plan.legacyIds, canonical, plan.legacyPage.id);
    annotationByPage.set(plan.finalPage.id, canonical);
    const existingIndex = pages.findIndex((page) => page.id === plan.finalPage.id);
    if (existingIndex >= 0) pages[existingIndex] = plan.finalPage;
    else pages.push(plan.finalPage);
  }

  const documents = await inventoryDocuments(
    projectRoot,
    existingManifest?.documents || [],
    legacyManifest.pages,
    pageIdMap
  );
  const migration = {
    source: LEGACY_MANIFEST_PATH,
    migratedAt: timestamp,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    pageIdParityVerified: true,
    pageIdMap
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
  const previews = await buildPreviews(projectRoot, documents, existingManifest);
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
  const htmlSources = new Map();
  for (const plan of pagePlans) {
    const html = await readFile((await assertSafeProjectFile(projectRoot, plan.htmlPath, "legacy HTML")).absolutePath, "utf8");
    htmlSources.set(plan.htmlPath, upsertIntegration(html, {
      src: relativeWebPath(plan.htmlPath, SDK_PATH),
      projectId,
      pageId: plan.finalPage.id,
      viewSrc: relativeWebPath(plan.htmlPath, plan.finalPage.viewFile)
    }));
  }
  const operations = [
    ...pagePlans.map((plan) => makeProjectOperation(
      projectRoot,
      plan.finalPage.annotationFile,
      `${JSON.stringify(annotationByPage.get(plan.finalPage.id), null, 2)}\n`
    )),
    ...[...viewSources].map(([relativePath, source]) => makeProjectOperation(projectRoot, relativePath, source)),
    ...[...htmlSources].map(([relativePath, source]) => makeProjectOperation(projectRoot, relativePath, source)),
    makeProjectOperation(projectRoot, V2_MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`)
  ];
  await applyProjectTransaction({
    projectRoot,
    operations,
    transactionHooks,
    verify: async () => {
      const installedBytes = await readSafeBytes(projectRoot, V2_MANIFEST_PATH, "migrated manifest");
      if (canonicalJson(parseJson(installedBytes, "migrated manifest")) !== canonicalJson(nextManifest)) {
        fail("Migrated manifest verification failed");
      }
      for (const plan of pagePlans) {
        const canonical = parseJson(
          await readSafeBytes(projectRoot, plan.finalPage.annotationFile, `migrated annotation ${plan.finalPage.id}`),
          `migrated annotation ${plan.finalPage.id}`
        );
        verifyAnnotationParity(plan.legacyIds, canonical, plan.legacyPage.id);
      }
      await checkProject({ projectRoot });
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
  onWarning
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
      transactionHooks
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

export async function runMigrateLegacyCli({ argv, now, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const manifest = await migrateLegacy({ ...parseArguments(argv || []), now });
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
