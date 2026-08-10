import {
  lstat,
  readFile,
  realpath
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverDocuments, DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { assertInsideProject } from "./lib/project.mjs";
import {
  applyProjectTransaction,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import {
  canonicalJson,
  validateAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: refresh-project.mjs --project-root PATH [--preview-map PATH]";
const TRANSACTION_HOOK_NAMES = [
  "afterCommit",
  "beforeRollbackOperation",
  "beforeRollbackCommit",
  "afterOriginalRead",
  "afterBeforeImagePrepared",
  "beforeStageWrite",
  "beforeCommit"
];

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertSafeProjectFile(projectRoot, relativePath, label, { allowMissing = false } = {}) {
  assertProjectRelativePath(relativePath, label);
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  assertInsideProject(projectRoot, absolutePath, label);
  const rootStatus = await pathStatus(projectRoot);
  if (!rootStatus || !rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new Error(`Unsafe ${label} ancestor: project root`);
  }
  const resolvedRoot = await realpath(projectRoot);
  let current = projectRoot;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const status = await pathStatus(current);
    const isTarget = index === segments.length - 1;
    if (!status) {
      if (allowMissing) return { absolutePath, exists: false };
      throw new Error(`Invalid ${label}`);
    }
    if (status.isSymbolicLink()) {
      throw new Error(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${segments.slice(0, index + 1).join("/")}`);
    }
    if (!isTarget && !status.isDirectory()) {
      throw new Error(`Unsafe ${label} ancestor: ${segments.slice(0, index + 1).join("/")}`);
    }
    if (isTarget && !status.isFile()) throw new Error(`Unsafe ${label} target: ${relativePath}`);
    const resolvedCurrent = await realpath(current);
    try {
      assertInsideProject(resolvedRoot, resolvedCurrent, label);
    } catch {
      throw new Error(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${segments.slice(0, index + 1).join("/")}`);
    }
  }
  return { absolutePath, exists: true };
}

function assertProjectRelativePath(value, label) {
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

function validateTransactionHooks(transactionHooks) {
  if (!transactionHooks || typeof transactionHooks !== "object") throw new Error("Invalid transactionHooks");
  for (const hookName of TRANSACTION_HOOK_NAMES) {
    if (transactionHooks[hookName] !== undefined && typeof transactionHooks[hookName] !== "function") {
      throw new Error("Invalid transactionHooks");
    }
  }
  return transactionHooks;
}

async function readAuthorizedJson(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

async function readExistingManifest(projectRoot) {
  let absolutePath;
  try {
    const result = await assertSafeProjectFile(projectRoot, MANIFEST_PATH, "existing manifest");
    absolutePath = result.absolutePath;
  } catch (error) {
    if (error.message === "Invalid existing manifest") throw new Error("Refresh requires an existing manifest");
    throw error;
  }
  try {
    const manifest = JSON.parse(await readFile(absolutePath, "utf8"));
    validateManifestV2(manifest);
    return manifest;
  } catch (error) {
    throw new Error(`Invalid existing manifest: ${error.message}`);
  }
}

function normalizePreviewMap(value, documents) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid preview-map: expected a JSON object");
  const documentByPath = new Map(documents.map((entry) => [entry.path, entry]));
  const result = {};
  for (const [relativePath, content] of Object.entries(value)) {
    try {
      assertProjectRelativePath(relativePath, "preview-map path");
    } catch (error) {
      throw new Error(`Invalid preview-map path: ${error.message}`);
    }
    const documentEntry = documentByPath.get(relativePath);
    if (!documentEntry || !DOCUMENT_FORMATS.binary.has(documentEntry.format) || documentEntry.missing) {
      throw new Error(`Invalid preview-map document path: ${relativePath}`);
    }
    if (typeof content !== "string") throw new Error(`Invalid preview-map text for ${relativePath}`);
    if (content.length === 0) throw new Error(`Invalid preview-map text for ${relativePath}: must be non-empty`);
    result[relativePath] = content;
  }
  return result;
}

function bindBinaryPreviewMetadata(documents, previews) {
  return documents.map((documentEntry) => {
    if (!DOCUMENT_FORMATS.binary.has(documentEntry.format)) return documentEntry;
    if (documentEntry.missing) {
      return { ...documentEntry, previewStatus: "missing", previewFingerprint: null };
    }
    const content = previews[documentEntry.path];
    if (typeof content === "string" && content.length > 0) {
      return {
        ...documentEntry,
        previewStatus: "available",
        previewFingerprint: `sha256:${createHash("sha256").update(content).digest("hex")}`
      };
    }
    return { ...documentEntry, previewStatus: "unavailable", previewFingerprint: null };
  });
}

async function buildPreviews(projectRoot, documents, previewMap) {
  const previews = { ...previewMap };
  for (const documentEntry of documents) {
    if (documentEntry.missing || !DOCUMENT_FORMATS.text.has(documentEntry.format)) continue;
    const absolutePath = path.resolve(projectRoot, ...documentEntry.path.split("/"));
    assertInsideProject(projectRoot, absolutePath, documentEntry.path);
    const status = await lstat(absolutePath);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Unsafe document source: ${documentEntry.path}`);
    previews[documentEntry.path] = await readFile(absolutePath, "utf8");
  }
  return previews;
}

async function refreshProjectLocked({ projectRoot, previewMap, now, transactionHooks = {} } = {}) {
  validateTransactionHooks(transactionHooks);
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const manifest = await readExistingManifest(normalizedRoot);
  const discoveredDocuments = await discoverDocuments({ projectRoot: normalizedRoot, existingDocuments: manifest.documents });
  const normalizedPreviewMap = normalizePreviewMap(previewMap, discoveredDocuments);
  const previews = await buildPreviews(normalizedRoot, discoveredDocuments, normalizedPreviewMap);
  const documents = bindBinaryPreviewMetadata(discoveredDocuments, previews);
  const generatedAt = normalizeNow(now);
  const refreshedManifest = { ...manifest, documents };
  validateManifestV2(refreshedManifest);

  const viewSources = new Map();
  for (const page of refreshedManifest.pages) {
    const annotationDocument = await readAuthorizedJson(normalizedRoot, page.annotationFile, "annotation file");
    try {
      validateAnnotationDocument(annotationDocument);
    } catch (error) {
      throw new Error(`Invalid annotation file for ${page.id}: ${error.message}`);
    }
    if (annotationDocument.projectId !== refreshedManifest.project.id || annotationDocument.page.id !== page.id) {
      throw new Error(`Invalid annotation identity for ${page.id}`);
    }
    const bundle = buildViewBundle({
      manifest: refreshedManifest,
      page,
      annotationDocument,
      documents,
      previews,
      generatedAt
    });
    viewSources.set(page.viewFile, serializeViewBundle(bundle));
  }

  const operations = [
    ...refreshedManifest.pages.map((page) => makeProjectOperation(
      normalizedRoot,
      page.viewFile,
      viewSources.get(page.viewFile)
    )),
    makeProjectOperation(normalizedRoot, MANIFEST_PATH, `${JSON.stringify(refreshedManifest, null, 2)}\n`)
  ];
  for (const operation of operations) {
    await assertSafeProjectFile(normalizedRoot, operation.relativePath, "refresh output", { allowMissing: true });
  }
  await applyProjectTransaction({
    projectRoot: normalizedRoot,
    operations,
    transactionHooks,
    verify: async () => {
      const installedManifest = JSON.parse(await readFile(path.join(normalizedRoot, ...MANIFEST_PATH.split("/")), "utf8"));
      validateManifestV2(installedManifest);
      if (canonicalJson(installedManifest) !== canonicalJson(refreshedManifest)) throw new Error("Refreshed manifest verification failed");
      for (const [relativePath, expectedSource] of viewSources) {
        const actualSource = await readFile(path.join(normalizedRoot, ...relativePath.split("/")), "utf8");
        if (actualSource !== expectedSource) throw new Error(`Refreshed view verification failed: ${relativePath}`);
      }
    }
  });
  return refreshedManifest;
}

export async function refreshProject({
  projectRoot,
  previewMap,
  now,
  transactionHooks = {},
  projectLock,
  projectLockOptions = {},
  onWarning
} = {}) {
  validateTransactionHooks(transactionHooks);
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  return withProjectMutationLock(
    normalizedRoot,
    () => refreshProjectLocked({
      projectRoot: normalizedRoot,
      previewMap,
      now,
      transactionHooks
    }),
    {
      lease: projectLock,
      lockOptions: projectLockOptions,
      onWarning
    }
  );
}

function parseArguments(argv) {
  if (argv.length !== 2 && argv.length !== 4) throw new Error(USAGE);
  if (argv[0] !== "--project-root" || !argv[1] || argv[1].startsWith("--")) throw new Error(USAGE);
  if (argv.length === 4 && (argv[2] !== "--preview-map" || !argv[3] || argv[3].startsWith("--"))) throw new Error(USAGE);
  return { projectRoot: argv[1], previewMapPath: argv[3] };
}

async function readPreviewMapFile(previewMapPath) {
  if (!previewMapPath) return undefined;
  const status = await pathStatus(path.resolve(previewMapPath));
  if (!status || !status.isFile() || status.isSymbolicLink()) throw new Error("Invalid preview-map file");
  try {
    return JSON.parse(await readFile(path.resolve(previewMapPath), "utf8"));
  } catch (error) {
    throw new Error(`Invalid preview-map file: ${error.message}`);
  }
}

export async function runRefreshCli({
  argv,
  now,
  transactionHooks,
  projectLockOptions,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  try {
    const options = parseArguments(argv || []);
    const previewMapValue = await readPreviewMapFile(options.previewMapPath);
    const refreshedManifest = await refreshProject({
      projectRoot: options.projectRoot,
      previewMap: previewMapValue,
      now,
      transactionHooks,
      projectLockOptions,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`)
    });
    stdout.write(`${JSON.stringify(refreshedManifest, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message === USAGE ? USAGE : error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runRefreshCli({ argv: process.argv.slice(2) });
}
