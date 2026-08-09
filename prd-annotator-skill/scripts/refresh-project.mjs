import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rmdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverDocuments, DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { assertInsideProject, toProjectPath } from "./lib/project.mjs";
import {
  canonicalJson,
  validateAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: refresh-project.mjs --project-root PATH [--preview-map PATH]";

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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

function normalizeNow(now) {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("now must produce a valid date");
  return date.toISOString();
}

async function readAuthorizedJson(projectRoot, relativePath, label) {
  assertProjectRelativePath(relativePath, label);
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  assertInsideProject(projectRoot, absolutePath, label);
  const status = await pathStatus(absolutePath);
  if (!status || !status.isFile() || status.isSymbolicLink()) throw new Error(`Invalid ${label}`);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

async function readExistingManifest(projectRoot) {
  const absolutePath = path.join(projectRoot, ...MANIFEST_PATH.split("/"));
  const status = await pathStatus(absolutePath);
  if (!status) throw new Error("Refresh requires an existing manifest");
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("Invalid existing manifest file");
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
    result[relativePath] = content;
  }
  return result;
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

function makeOperation(projectRoot, relativePath, data) {
  assertProjectRelativePath(relativePath, "refresh output path");
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  assertInsideProject(projectRoot, absolutePath, relativePath);
  return { relativePath, absolutePath, data };
}

async function ensureParentDirectories(projectRoot, targetDirectory, createdDirectories) {
  const relative = path.relative(projectRoot, targetDirectory);
  const segments = relative ? relative.split(path.sep) : [];
  let current = projectRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const status = await pathStatus(current);
    if (status) {
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new Error(`Unsafe refresh directory: ${toProjectPath(projectRoot, current)}`);
      }
      continue;
    }
    await mkdir(current, { recursive: false });
    createdDirectories.add(current);
  }
}

async function removeCreatedDirectories(createdDirectories) {
  for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    }
  }
}

async function applyTransaction(projectRoot, operations, verify) {
  const stagingRoot = path.join(projectRoot, `.prd-annotator-refresh-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const prepared = [];
  const committed = [];
  const createdDirectories = new Set();
  try {
    await mkdir(stagingRoot, { recursive: false });
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const status = await pathStatus(operation.absolutePath);
      if (status?.isSymbolicLink() || (status && !status.isFile())) throw new Error(`Refusing to replace unsafe path: ${operation.relativePath}`);
      const stagePath = path.join(stagingRoot, `new-${index}`);
      const backupPath = path.join(stagingRoot, `backup-${index}`);
      await writeFile(stagePath, operation.data);
      if (status) await copyFile(operation.absolutePath, backupPath);
      prepared.push({ ...operation, existed: Boolean(status), stagePath, backupPath });
    }

    try {
      for (const operation of prepared) {
        await ensureParentDirectories(projectRoot, path.dirname(operation.absolutePath), createdDirectories);
        await rename(operation.stagePath, operation.absolutePath);
        committed.push(operation);
      }
      await verify();
    } catch (error) {
      for (const operation of committed.reverse()) {
        if (operation.existed) await copyFile(operation.backupPath, operation.absolutePath);
        else await rm(operation.absolutePath, { force: true });
      }
      await removeCreatedDirectories(createdDirectories);
      throw error;
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function refreshProject({ projectRoot, previewMap, now } = {}) {
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const manifest = await readExistingManifest(normalizedRoot);
  const documents = await discoverDocuments({ projectRoot: normalizedRoot, existingDocuments: manifest.documents });
  const normalizedPreviewMap = normalizePreviewMap(previewMap, documents);
  const previews = await buildPreviews(normalizedRoot, documents, normalizedPreviewMap);
  const generatedAt = normalizeNow(now);
  const refreshedManifest = { ...manifest, documents };
  validateManifestV2(refreshedManifest);

  const viewSources = new Map();
  for (const page of refreshedManifest.pages) {
    const annotationDocument = await readAuthorizedJson(normalizedRoot, page.annotationFile, `annotation file for ${page.id}`);
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
    ...refreshedManifest.pages.map((page) => makeOperation(normalizedRoot, page.viewFile, viewSources.get(page.viewFile))),
    makeOperation(normalizedRoot, MANIFEST_PATH, `${JSON.stringify(refreshedManifest, null, 2)}\n`)
  ];
  await applyTransaction(normalizedRoot, operations, async () => {
    const installedManifest = JSON.parse(await readFile(path.join(normalizedRoot, ...MANIFEST_PATH.split("/")), "utf8"));
    validateManifestV2(installedManifest);
    if (canonicalJson(installedManifest) !== canonicalJson(refreshedManifest)) throw new Error("Refreshed manifest verification failed");
    for (const [relativePath, expectedSource] of viewSources) {
      const actualSource = await readFile(path.join(normalizedRoot, ...relativePath.split("/")), "utf8");
      if (actualSource !== expectedSource) throw new Error(`Refreshed view verification failed: ${relativePath}`);
    }
  });
  return refreshedManifest;
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

export async function runRefreshCli({ argv, now, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArguments(argv || []);
    const previewMapValue = await readPreviewMapFile(options.previewMapPath);
    const refreshedManifest = await refreshProject({ projectRoot: options.projectRoot, previewMap: previewMapValue, now });
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
