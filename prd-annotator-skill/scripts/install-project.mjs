import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProject } from "./discover-project.mjs";
import { inspectIntegration, relativeWebPath, upsertIntegration } from "./lib/html.mjs";
import { assertInsideProject, derivePageId, toProjectPath } from "./lib/project.mjs";
import { OFFICIAL_REPOSITORY, resolveLatestRelease, sha256 } from "./lib/release.mjs";
import {
  createEmptyAnnotationDocument,
  fingerprintValue,
  validateManifestV2
} from "./lib/schema.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const SDK_PATH = ".prd-annotator/sdk/prd-annotator.js";
const PAGE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const USAGE = "Usage: install-project.mjs --project-root PATH --confirm-install [--confirm-upgrade] --page PATH [--page PATH ...]";

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeNow(now) {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("now must produce a valid date");
  return date.toISOString();
}

function titleFromHtml(html, htmlPath, pageId) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (title) return title;
  const stem = path.posix.basename(htmlPath).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return stem || pageId;
}

function validateReleaseInfo(releaseInfo) {
  const version = releaseInfo?.version;
  const expectedUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/v${version}`;
  if (!RELEASE_VERSION_PATTERN.test(version || "") || releaseInfo?.releaseUrl !== expectedUrl) {
    throw new Error("Release metadata is not an official formal Release");
  }
  if (!Buffer.isBuffer(releaseInfo.sdkBuffer)) throw new Error("Release SDK asset must be a Buffer");
  if (!/^[a-f0-9]{64}$/.test(releaseInfo.sha256 || "") || sha256(releaseInfo.sdkBuffer) !== releaseInfo.sha256) {
    throw new Error("Downloaded SDK SHA-256 does not match the Release checksum");
  }
  return releaseInfo;
}

async function readExistingManifest(projectRoot) {
  const manifestAbsolute = path.join(projectRoot, ...MANIFEST_PATH.split("/"));
  const status = await pathStatus(manifestAbsolute);
  if (!status) {
    const installDirectory = path.join(projectRoot, ".prd-annotator");
    const directoryStatus = await pathStatus(installDirectory);
    if (directoryStatus) {
      if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
        throw new Error("Invalid existing manifest: .prd-annotator is not a safe directory");
      }
      if ((await readdir(installDirectory)).length) {
        throw new Error("Invalid existing manifest: .prd-annotator contains data but manifest.json is missing");
      }
    }
    return null;
  }
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("Invalid existing manifest file");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestAbsolute, "utf8"));
    validateManifestV2(manifest);
  } catch (error) {
    throw new Error(`Invalid existing manifest: ${error.message}`);
  }
  return manifest;
}

function assertSafeSelectedPage(pagePath) {
  if (
    typeof pagePath !== "string"
    || !pagePath
    || pagePath !== pagePath.trim()
    || pagePath.includes("\\")
    || pagePath.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(pagePath)
    || pagePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid explicit page path: ${pagePath}`);
  }
}

function makePageData(pageEntry) {
  return {
    id: pageEntry.id,
    title: pageEntry.title,
    htmlPath: pageEntry.htmlPath,
    route: `/${pageEntry.htmlPath}`
  };
}

function renderViewBundle(projectId, pageEntry, document, generatedAt) {
  const bundle = {
    schemaVersion: 2,
    generatedAt,
    projectId,
    page: makePageData(pageEntry),
    persistedAnnotationFingerprint: fingerprintValue(document.annotations),
    document,
    documents: []
  };
  return `window.PRDAnnotator.hydrateView(${JSON.stringify(bundle)});\n`;
}

function makeOperation(projectRoot, relativePath, data, { overwrite = true } = {}) {
  const absolutePath = path.resolve(projectRoot, ...relativePath.split("/"));
  assertInsideProject(projectRoot, absolutePath, relativePath);
  return { relativePath, absolutePath, data, overwrite };
}

async function ensureParentDirectories(projectRoot, targetDirectory, createdDirectories) {
  const relative = path.relative(projectRoot, targetDirectory);
  const segments = relative ? relative.split(path.sep) : [];
  let current = projectRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const status = await pathStatus(current);
    if (status) {
      if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Unsafe installation directory: ${toProjectPath(projectRoot, current)}`);
      continue;
    }
    await mkdir(current, { recursive: false });
    createdDirectories.add(current);
  }
}

async function removeCreatedDirectories(createdDirectories) {
  const directories = [...createdDirectories].sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") throw error;
    }
  }
}

async function applyTransaction(projectRoot, operations, verify, onChange) {
  const stagingRoot = path.join(projectRoot, `.prd-annotator-install-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const prepared = [];
  const committed = [];
  const createdDirectories = new Set();
  try {
    await mkdir(stagingRoot, { recursive: false });
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const status = await pathStatus(operation.absolutePath);
      if (status?.isSymbolicLink() || (status && !status.isFile())) throw new Error(`Refusing to replace unsafe path: ${operation.relativePath}`);
      if (status && !operation.overwrite) continue;
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
        onChange?.(operation.relativePath);
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

async function verifyInstalledProject(projectRoot, manifest) {
  validateManifestV2(manifest);
  const sdkAbsolute = path.join(projectRoot, ...SDK_PATH.split("/"));
  const installedSdk = await readFile(sdkAbsolute);
  if (sha256(installedSdk) !== manifest.project.sdk.sha256) throw new Error("Installed SDK checksum does not match manifest");

  for (const pageEntry of manifest.pages) {
    const htmlAbsolute = path.resolve(projectRoot, ...pageEntry.htmlPath.split("/"));
    const annotationAbsolute = path.resolve(projectRoot, ...pageEntry.annotationFile.split("/"));
    const viewAbsolute = path.resolve(projectRoot, ...pageEntry.viewFile.split("/"));
    for (const [candidate, label] of [
      [htmlAbsolute, "HTML"],
      [annotationAbsolute, "annotation"],
      [viewAbsolute, "view"]
    ]) {
      assertInsideProject(projectRoot, candidate, `${label} path`);
      const status = await pathStatus(candidate);
      if (!status?.isFile() || status.isSymbolicLink()) throw new Error(`${label} path is missing or unsafe for ${pageEntry.htmlPath}`);
    }
    const html = await readFile(htmlAbsolute, "utf8");
    const integrations = inspectIntegration(html);
    if (integrations.length !== 1) throw new Error(`${pageEntry.htmlPath} must contain exactly one PRD Annotator script`);
    const [integration] = integrations;
    if (integration.projectId !== manifest.project.id || integration.pageId !== pageEntry.id) {
      throw new Error(`${pageEntry.htmlPath} integration identity does not match manifest`);
    }
    const resolvedSdk = path.posix.normalize(path.posix.join(path.posix.dirname(pageEntry.htmlPath), integration.src));
    const resolvedView = path.posix.normalize(path.posix.join(path.posix.dirname(pageEntry.htmlPath), integration.viewSrc));
    if (resolvedSdk !== SDK_PATH || resolvedView !== pageEntry.viewFile || resolvedSdk.startsWith("../") || resolvedView.startsWith("../")) {
      throw new Error(`${pageEntry.htmlPath} integration path resolves outside the project or does not match manifest`);
    }
  }
}

export async function installProject({
  projectRoot,
  pagePaths,
  confirmInstall = false,
  confirmUpgrade = false,
  releaseClient,
  now,
  onChange
} = {}) {
  if (confirmInstall !== true) throw new Error("--confirm-install is required");
  if (!projectRoot) throw new Error("projectRoot is required");
  if (!Array.isArray(pagePaths) || !pagePaths.length) throw new Error("At least one explicit --page is required");
  if (new Set(pagePaths).size !== pagePaths.length) throw new Error("Each --page selection must be unique");
  for (const pagePath of pagePaths) assertSafeSelectedPage(pagePath);

  const normalizedRoot = path.resolve(projectRoot);
  const rootStatus = await pathStatus(normalizedRoot);
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) throw new Error("projectRoot must be a non-symlink directory");
  const existingManifest = await readExistingManifest(normalizedRoot);
  const discovery = await discoverProject({ projectRoot: normalizedRoot });
  const candidates = new Map(discovery.htmlCandidates.map((candidate) => [candidate.htmlPath, candidate]));
  for (const pagePath of pagePaths) {
    const candidate = candidates.get(pagePath);
    if (!candidate) throw new Error(`Explicit page is not a discovered source HTML file: ${pagePath}`);
    if (candidate.locationEvidence === "application-like") throw new Error(`Explicit page is not prototype source HTML: ${pagePath}`);
  }

  const selected = [];
  for (const htmlPath of pagePaths) {
    const absolutePath = path.resolve(normalizedRoot, ...htmlPath.split("/"));
    assertInsideProject(normalizedRoot, absolutePath, "HTML path");
    const status = await pathStatus(absolutePath);
    if (!status?.isFile() || status.isSymbolicLink()) throw new Error(`Selected HTML is missing or unsafe: ${htmlPath}`);
    const html = await readFile(absolutePath, "utf8");
    const integrations = inspectIntegration(html);
    if (integrations.length > 1) throw new Error("HTML contains more than one PRD Annotator script");
    selected.push({ htmlPath, absolutePath, html, integration: integrations[0] || null });
  }

  const timestamp = normalizeNow(now);
  const projectId = existingManifest?.project.id || discovery.suggestedProjectId;
  const existingPages = existingManifest?.pages.map((page) => structuredClone(page)) || [];
  const usedIds = new Set(existingPages.map((page) => page.id));
  const selectedEntries = [];
  const selectedIds = new Set();
  for (const selection of selected) {
    const manifestPage = existingPages.find((page) => page.htmlPath === selection.htmlPath);
    const injectedId = selection.integration?.validPageId ? selection.integration.pageId : null;
    let pageId = manifestPage?.id || injectedId;
    if (pageId && selectedIds.has(pageId)) throw new Error(`Duplicate selected page id: ${pageId}`);
    if (!pageId) pageId = derivePageId(selection.htmlPath, usedIds);
    usedIds.add(pageId);
    selectedIds.add(pageId);

    const priorById = existingPages.find((page) => page.id === pageId);
    if (priorById && priorById.htmlPath !== selection.htmlPath) {
      const priorHtmlAbsolute = path.resolve(normalizedRoot, ...priorById.htmlPath.split("/"));
      assertInsideProject(normalizedRoot, priorHtmlAbsolute, "existing manifest HTML path");
      if (await pathStatus(priorHtmlAbsolute)) {
        throw new Error(`Injected page id ${pageId} already belongs to ${priorById.htmlPath}`);
      }
    }
    const title = titleFromHtml(selection.html, selection.htmlPath, pageId);
    const pageEntry = {
      id: pageId,
      title,
      htmlPath: selection.htmlPath,
      annotationFile: priorById?.annotationFile || `.prd-annotator/data/pages/${pageId}.json`,
      viewFile: priorById?.viewFile || `.prd-annotator/view/pages/${pageId}.js`,
      display: {
        enabled: true,
        updatedAt: timestamp
      }
    };
    selectedEntries.push({ selection, pageEntry, priorById });
  }

  let pages = existingPages;
  for (const { pageEntry, priorById } of selectedEntries) {
    const replaceIndex = priorById ? pages.findIndex((page) => page.id === priorById.id) : pages.findIndex((page) => page.htmlPath === pageEntry.htmlPath);
    if (replaceIndex >= 0) pages[replaceIndex] = pageEntry;
    else pages.push(pageEntry);
  }
  const pageIds = new Set();
  const pagePathsSeen = new Set();
  for (const pageEntry of pages) {
    if (pageIds.has(pageEntry.id) || pagePathsSeen.has(pageEntry.htmlPath)) throw new Error("Manifest page identities or HTML paths would be duplicated");
    pageIds.add(pageEntry.id);
    pagePathsSeen.add(pageEntry.htmlPath);
  }

  let sdkMetadata;
  let sdkBytes = null;
  if (!existingManifest || confirmUpgrade === true) {
    if (!releaseClient || typeof releaseClient.getLatestRelease !== "function") throw new Error("releaseClient.getLatestRelease is required");
    const releaseInfo = validateReleaseInfo(await releaseClient.getLatestRelease());
    sdkBytes = releaseInfo.sdkBuffer;
    sdkMetadata = {
      version: releaseInfo.version,
      releaseUrl: releaseInfo.releaseUrl,
      sha256: releaseInfo.sha256,
      installedAt: timestamp
    };
  } else {
    sdkMetadata = existingManifest.project.sdk;
    const sdkAbsolute = path.join(normalizedRoot, ...SDK_PATH.split("/"));
    const status = await pathStatus(sdkAbsolute);
    if (!status?.isFile() || status.isSymbolicLink()) throw new Error("Installed SDK recorded by manifest is missing or unsafe");
    const installedBytes = await readFile(sdkAbsolute);
    if (sha256(installedBytes) !== sdkMetadata.sha256) throw new Error("Installed SDK checksum does not match manifest");
  }

  const manifest = {
    schemaVersion: 2,
    project: { id: projectId, sdk: sdkMetadata },
    pages,
    documents: existingManifest?.documents || [],
    migration: existingManifest?.migration ?? null
  };
  validateManifestV2(manifest);

  const sdkOperations = sdkBytes ? [makeOperation(normalizedRoot, SDK_PATH, sdkBytes)] : [];
  const dataOperations = [];
  const htmlOperations = [];
  for (const { selection, pageEntry, priorById } of selectedEntries) {
    const pageData = makePageData(pageEntry);
    const document = createEmptyAnnotationDocument({ projectId, page: pageData });
    dataOperations.push(makeOperation(
      normalizedRoot,
      pageEntry.annotationFile,
      `${JSON.stringify(document, null, 2)}\n`,
      { overwrite: false }
    ));
    dataOperations.push(makeOperation(
      normalizedRoot,
      pageEntry.viewFile,
      renderViewBundle(projectId, pageEntry, document, timestamp),
      { overwrite: false }
    ));
    const html = upsertIntegration(selection.html, {
      src: relativeWebPath(pageEntry.htmlPath, SDK_PATH),
      projectId,
      pageId: pageEntry.id,
      viewSrc: relativeWebPath(pageEntry.htmlPath, pageEntry.viewFile)
    });
    if (priorById && priorById.annotationFile !== pageEntry.annotationFile) throw new Error("Existing annotation path cannot be changed");
    htmlOperations.push(makeOperation(normalizedRoot, pageEntry.htmlPath, html));
  }
  const manifestOperation = makeOperation(normalizedRoot, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  const operations = [...sdkOperations, ...dataOperations, manifestOperation, ...htmlOperations];

  await applyTransaction(
    normalizedRoot,
    operations,
    () => verifyInstalledProject(normalizedRoot, manifest),
    onChange
  );
  return manifest;
}

function parseArguments(argv) {
  if (argv.length < 4 || argv[0] !== "--project-root" || !argv[1] || argv[1].startsWith("--")) throw new Error(USAGE);
  const result = { projectRoot: argv[1], confirmInstall: false, confirmUpgrade: false, pagePaths: [] };
  let index = 2;
  if (argv[index] === "--confirm-install") {
    result.confirmInstall = true;
    index += 1;
  }
  if (argv[index] === "--confirm-upgrade") {
    result.confirmUpgrade = true;
    index += 1;
  }
  while (index < argv.length) {
    if (argv[index] !== "--page" || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(USAGE);
    result.pagePaths.push(argv[index + 1]);
    index += 2;
  }
  if (!result.pagePaths.length) throw new Error(USAGE);
  return result;
}

const invokedPath = fileURLToPath(import.meta.url);
export async function runInstallerCli({
  argv,
  releaseClient,
  now,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  try {
    const options = parseArguments(argv || []);
    const changedPaths = [];
    const manifest = await installProject({
      ...options,
      releaseClient: releaseClient || {
        getLatestRelease: () => resolveLatestRelease({ fetchImpl: fetch, repository: OFFICIAL_REPOSITORY })
      },
      now,
      onChange: (changedPath) => changedPaths.push(changedPath)
    });
    stdout.write(`${JSON.stringify({ installedVersion: manifest.project.sdk.version, changedPaths }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message === USAGE ? USAGE : error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runInstallerCli({ argv: process.argv.slice(2) });
}
