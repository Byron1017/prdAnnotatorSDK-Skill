import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProject, assertSafeProjectFile } from "./check-project.mjs";
import { DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import {
  applyProjectTransaction,
  assertProjectRelativePath,
  assertSafeProjectWritePath,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import { canonicalJson, validateManifestV2 } from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";
import { renderManagedPagePrd, renderManagedTotalPrd } from "./lib/managed-prd.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: generate-prd.mjs --project-root PATH [--page PAGE_ID ...] [--total] [--document-root PROJECT_RELATIVE_PATH] --confirm-prd-write";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function fail(message) {
  throw new Error(message);
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readSafeJson(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

function validateInputs({ pageIds, total, documentRoot, transactionHooks }) {
  if (!Array.isArray(pageIds)) fail("pageIds must be an array");
  if (pageIds.some((pageId) => typeof pageId !== "string" || !/^[a-z0-9-]{1,32}$/.test(pageId))) {
    fail("Invalid pageIds");
  }
  if (new Set(pageIds).size !== pageIds.length) fail("Duplicate pageIds are not allowed");
  if (total !== undefined && typeof total !== "boolean") fail("total must be a boolean");
  if (!pageIds.length && total !== true) fail("At least one --page or --total is required");
  if (documentRoot !== undefined && documentRoot !== ".") assertProjectRelativePath(documentRoot, "documentRoot");
  if (
    !transactionHooks
    || typeof transactionHooks !== "object"
    || (transactionHooks.afterCommit !== undefined && typeof transactionHooks.afterCommit !== "function")
    || (transactionHooks.beforeRollbackOperation !== undefined
      && typeof transactionHooks.beforeRollbackOperation !== "function")
  ) fail("Invalid transactionHooks");
}

function rootFromDocument(entry) {
  const directory = path.posix.dirname(entry.path);
  if (entry.kind === "page-prd" && path.posix.basename(directory).toLowerCase() === "pages") {
    return path.posix.dirname(directory);
  }
  return directory;
}

function plausibleRoots(manifest) {
  const candidates = new Set();
  for (const entry of manifest.documents) {
    if (!["page-prd", "total-prd"].includes(entry.kind) || entry.missing) continue;
    const candidate = rootFromDocument(entry);
    if (candidate) candidates.add(candidate);
  }
  for (const page of manifest.pages) {
    if (!page.managedPrdFile) continue;
    const candidate = rootFromDocument({ path: page.managedPrdFile, kind: "page-prd" });
    if (candidate) candidates.add(candidate);
  }
  if (manifest.managedTotalPrdFile) {
    const candidate = path.posix.dirname(manifest.managedTotalPrdFile);
    if (candidate) candidates.add(candidate);
  }
  return [...candidates].sort();
}

async function selectDocumentRoot(projectRoot, manifest, explicitRoot) {
  if (explicitRoot !== undefined) {
    if (explicitRoot !== ".") {
      await assertSafeProjectWritePath(projectRoot, explicitRoot, "documentRoot", { targetType: "directory" });
    }
    return explicitRoot;
  }
  const candidates = plausibleRoots(manifest);
  if (candidates.length > 1) fail(`Multiple document roots are plausible: ${candidates.join(", ")}`);
  return candidates[0] || "doc/prd";
}

function underDocumentRoot(root, relativePath) {
  return root === "." ? relativePath : `${root}/${relativePath}`;
}

function sha256Fingerprint(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function managedDocumentId(relativePath) {
  return `doc-managed-${createHash("sha256").update(relativePath).digest("hex").slice(0, 10)}`;
}

function updateManagedDocument(documents, { relativePath, title, kind, pageIds, source }) {
  const existingIndex = documents.findIndex((entry) => entry.path === relativePath);
  const value = {
    id: existingIndex >= 0 ? documents[existingIndex].id : managedDocumentId(relativePath),
    title,
    path: relativePath,
    format: "markdown",
    kind,
    pageIds,
    associationSource: "manual",
    evidence: [kind === "total-prd" ? "Skill-created managed total PRD" : "Skill-created managed page PRD"],
    fingerprint: sha256Fingerprint(source),
    previewStatus: "available",
    missing: false,
    managed: true
  };
  if (existingIndex >= 0) documents[existingIndex] = { ...documents[existingIndex], ...value };
  else documents.push(value);
}

async function assertManagedTarget(projectRoot, manifest, relativePath, authorizedManagedPaths) {
  await assertSafeProjectWritePath(projectRoot, relativePath, "managed PRD output");
  const inventoryEntry = manifest.documents.find((entry) => entry.path === relativePath);
  if (inventoryEntry && !authorizedManagedPaths.has(relativePath)) {
    fail(`Refusing to overwrite external document: ${relativePath}`);
  }
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  if (await pathStatus(absolutePath) && !authorizedManagedPaths.has(relativePath)) {
    fail(`Refusing to overwrite existing unmanaged file: ${relativePath}`);
  }
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

async function existingBinaryPreviews(projectRoot, manifest) {
  const previews = {};
  for (const page of manifest.pages) {
    const sourceFile = await assertSafeProjectFile(projectRoot, page.viewFile, "view file", { allowMissing: true });
    if (!sourceFile.exists) continue;
    const view = parseViewSource(await readFile(sourceFile.absolutePath, "utf8"));
    for (const entry of view?.documents || []) {
      if (entry.previewStatus === "available" && typeof entry.content === "string" && entry.content) {
        previews[entry.path] = entry.content;
      }
    }
  }
  return previews;
}

async function buildPreviews(projectRoot, documents, sourceByPath, manifest) {
  const previews = await existingBinaryPreviews(projectRoot, manifest);
  for (const entry of documents) {
    if (entry.missing || !DOCUMENT_FORMATS.text.has(entry.format)) continue;
    if (sourceByPath.has(entry.path)) previews[entry.path] = sourceByPath.get(entry.path);
    else {
      const source = await assertSafeProjectFile(projectRoot, entry.path, `document source ${entry.id}`);
      previews[entry.path] = await readFile(source.absolutePath, "utf8");
    }
  }
  return previews;
}

async function generateManagedPrdLocked({ projectRoot, pageIds, total, documentRoot, now, transactionHooks }) {
  const manifest = await readSafeJson(projectRoot, MANIFEST_PATH, "manifest");
  validateManifestV2(manifest);
  const nextManifest = clone(manifest);
  const nextDocuments = nextManifest.documents;
  const pageById = new Map(nextManifest.pages.map((page) => [page.id, page]));
  for (const pageId of pageIds) {
    if (!pageById.has(pageId)) fail(`Unknown page ID: ${pageId}`);
  }
  const root = await selectDocumentRoot(projectRoot, nextManifest, documentRoot);
  const skillCreatedPaths = new Set(
    nextManifest.documents.filter((entry) => entry.managed === true).map((entry) => entry.path)
  );
  const authorizedManagedPaths = new Set([
    ...nextManifest.pages.map((page) => page.managedPrdFile).filter((relativePath) => skillCreatedPaths.has(relativePath)),
    skillCreatedPaths.has(nextManifest.managedTotalPrdFile) ? nextManifest.managedTotalPrdFile : null
  ].filter(Boolean));
  const annotationByPage = new Map();
  for (const page of nextManifest.pages) {
    const annotation = await readSafeJson(projectRoot, page.annotationFile, `annotation file for ${page.id}`);
    if (annotation.projectId !== nextManifest.project.id || annotation.page?.id !== page.id) {
      fail(`Invalid annotation identity for ${page.id}`);
    }
    annotationByPage.set(page.id, annotation);
  }

  const sourceByPath = new Map();
  const changedPaths = [];
  for (const pageId of pageIds) {
    const page = pageById.get(pageId);
    const annotation = annotationByPage.get(pageId);
    const relativePath = page.managedPrdFile || underDocumentRoot(root, `pages/${page.id}.md`);
    await assertManagedTarget(projectRoot, manifest, relativePath, authorizedManagedPaths);
    const source = renderManagedPagePrd(annotation);
    page.managedPrdFile = relativePath;
    sourceByPath.set(relativePath, source);
    changedPaths.push(relativePath);
    updateManagedDocument(nextDocuments, {
      relativePath,
      title: page.title,
      kind: "page-prd",
      pageIds: [page.id],
      source
    });
  }
  if (total === true) {
    const relativePath = nextManifest.managedTotalPrdFile || underDocumentRoot(root, "PRD.md");
    await assertManagedTarget(projectRoot, manifest, relativePath, authorizedManagedPaths);
    const source = renderManagedTotalPrd(nextManifest, relativePath);
    nextManifest.managedTotalPrdFile = relativePath;
    sourceByPath.set(relativePath, source);
    changedPaths.push(relativePath);
    updateManagedDocument(nextDocuments, {
      relativePath,
      title: "Product Requirements",
      kind: "total-prd",
      pageIds: [],
      source
    });
  }
  validateManifestV2(nextManifest);
  const generatedAt = normalizeNow(now);
  const previews = await buildPreviews(projectRoot, nextDocuments, sourceByPath, manifest);
  const viewSources = new Map();
  for (const page of nextManifest.pages) {
    viewSources.set(page.viewFile, serializeViewBundle(buildViewBundle({
      manifest: nextManifest,
      page,
      annotationDocument: annotationByPage.get(page.id),
      documents: nextDocuments,
      previews,
      generatedAt
    })));
  }
  const operations = [
    ...[...sourceByPath].map(([relativePath, source]) => makeProjectOperation(projectRoot, relativePath, source)),
    ...[...viewSources].map(([relativePath, source]) => makeProjectOperation(projectRoot, relativePath, source)),
    makeProjectOperation(projectRoot, MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`)
  ];
  await applyProjectTransaction({
    projectRoot,
    operations,
    transactionHooks,
    verify: async () => {
      const installed = await readSafeJson(projectRoot, MANIFEST_PATH, "generated manifest");
      if (canonicalJson(installed) !== canonicalJson(nextManifest)) fail("Generated manifest verification failed");
      await checkProject({ projectRoot });
    }
  });
  return [...new Set(changedPaths)].sort();
}

export async function generateManagedPrd({
  projectRoot,
  pageIds = [],
  total = false,
  documentRoot,
  confirmPrdWrite,
  now,
  transactionHooks = {},
  projectLock,
  projectLockOptions = {},
  onWarning
} = {}) {
  if (confirmPrdWrite !== true) fail("--confirm-prd-write is required");
  validateInputs({ pageIds, total, documentRoot, transactionHooks });
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  return withProjectMutationLock(
    normalizedRoot,
    () => generateManagedPrdLocked({
      projectRoot: normalizedRoot,
      pageIds,
      total,
      documentRoot,
      now,
      transactionHooks
    }),
    { lease: projectLock, lockOptions: projectLockOptions, onWarning }
  );
}

function parseArguments(argv) {
  let projectRoot;
  let documentRoot;
  let total = false;
  let confirmPrdWrite = false;
  const pageIds = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--project-root", "--page", "--document-root"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(USAGE);
      if (argument === "--project-root") {
        if (projectRoot !== undefined) fail(USAGE);
        projectRoot = value;
      } else if (argument === "--page") pageIds.push(value);
      else {
        if (documentRoot !== undefined) fail(USAGE);
        documentRoot = value;
      }
      index += 1;
    } else if (argument === "--total") {
      if (total) fail(USAGE);
      total = true;
    } else if (argument === "--confirm-prd-write") {
      if (confirmPrdWrite) fail(USAGE);
      confirmPrdWrite = true;
    } else fail(USAGE);
  }
  if (!projectRoot) fail(USAGE);
  return { projectRoot, pageIds, total, documentRoot, confirmPrdWrite };
}

export async function runGeneratePrdCli({ argv, now, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const changed = await generateManagedPrd({ ...parseArguments(argv || []), now });
    stdout.write(`Generated managed PRDs:\n${changed.join("\n")}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runGeneratePrdCli({ argv: process.argv.slice(2) });
}
