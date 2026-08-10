import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverProject } from "./discover-project.mjs";
import {
  assertSafeProjectFile,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import { DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { inspectIntegration, relativeWebPath, upsertIntegration } from "./lib/html.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import { assertInsideProject, derivePageId } from "./lib/project.mjs";
import {
  applyProjectTransaction,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import {
  OFFICIAL_REPOSITORY,
  readSdkVersion,
  resolveLatestRelease,
  sha256,
  validateReleaseInfo
} from "./lib/release.mjs";
import {
  createEmptyAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const SDK_PATH = ".prd-annotator/sdk/prd-annotator.js";
const PAGE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const USAGE = "Usage: install-project.mjs --project-root PATH --confirm-install [--confirm-upgrade] --page PATH [--page PATH ...]";

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function titleFromHtml(html, htmlPath, pageId) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (title) return title;
  const stem = path.posix.basename(htmlPath).replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return stem || pageId;
}

async function readExactOrphanSdk(projectRoot, installDirectory) {
  const entries = await readdir(installDirectory);
  if (entries.length !== 1 || entries[0] !== "sdk") return null;
  const sdkDirectory = path.join(installDirectory, "sdk");
  const sdkDirectoryStatus = await pathStatus(sdkDirectory);
  if (!sdkDirectoryStatus?.isDirectory() || sdkDirectoryStatus.isSymbolicLink()) return null;
  const sdkEntries = await readdir(sdkDirectory);
  if (sdkEntries.length !== 1 || sdkEntries[0] !== "prd-annotator.js") return null;
  const sdkPath = path.join(projectRoot, ...SDK_PATH.split("/"));
  const sdkStatus = await pathStatus(sdkPath);
  if (!sdkStatus?.isFile() || sdkStatus.isSymbolicLink()) return null;
  return readFile(sdkPath);
}

async function readExistingManifest(projectRoot, { confirmUpgrade }) {
  const manifestAbsolute = path.join(projectRoot, ...MANIFEST_PATH.split("/"));
  const status = await pathStatus(manifestAbsolute);
  if (!status) {
    const installDirectory = path.join(projectRoot, ".prd-annotator");
    const directoryStatus = await pathStatus(installDirectory);
    if (directoryStatus) {
      if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
        throw new Error("Invalid existing manifest: .prd-annotator is not a safe directory");
      }
      const orphanSdkBytes = await readExactOrphanSdk(projectRoot, installDirectory);
      if (orphanSdkBytes) {
        if (confirmUpgrade !== true) {
          throw new Error("An orphan SDK requires explicit --confirm-upgrade recovery");
        }
        return { manifest: null, manifestBytes: null, orphanSdkBytes };
      }
      if ((await readdir(installDirectory)).length) {
        throw new Error("Invalid existing manifest: .prd-annotator contains data but manifest.json is missing");
      }
    }
    return { manifest: null, manifestBytes: null, orphanSdkBytes: null };
  }
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("Invalid existing manifest file");
  let manifest;
  let manifestBytes;
  try {
    manifestBytes = await readFile(manifestAbsolute);
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateManifestV2(manifest);
  } catch (error) {
    throw new Error(`Invalid existing manifest: ${error.message}`);
  }
  return { manifest, manifestBytes, orphanSdkBytes: null };
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

function samePageIdentity(left, right) {
  return left?.id === right?.id
    && left?.title === right?.title
    && left?.htmlPath === right?.htmlPath;
}

function parseViewBundle(source) {
  const prefix = "window.PRDAnnotator.hydrateView(";
  const suffix = ");\n";
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null;
  try {
    return JSON.parse(source.slice(prefix.length, -suffix.length));
  } catch {
    return null;
  }
}

async function collectDocumentPreviews(projectRoot, existingManifest, retainedViewBytes = new Map()) {
  const previews = {};
  for (const pageEntry of existingManifest?.pages || []) {
    const viewFile = await assertSafeProjectFile(projectRoot, pageEntry.viewFile, "existing view", { allowMissing: true });
    if (!viewFile.exists) continue;
    const bytes = retainedViewBytes.has(pageEntry.viewFile)
      ? retainedViewBytes.get(pageEntry.viewFile)
      : await readFile(viewFile.absolutePath);
    const view = parseViewBundle(bytes.toString("utf8"));
    for (const documentEntry of view?.documents || []) {
      if (documentEntry.previewStatus === "available" && typeof documentEntry.content === "string") {
        previews[documentEntry.path] = documentEntry.content;
      }
    }
  }
  for (const documentEntry of existingManifest?.documents || []) {
    if (documentEntry.missing || !DOCUMENT_FORMATS.text.has(documentEntry.format)) continue;
    const source = await assertSafeProjectFile(projectRoot, documentEntry.path, `document source ${documentEntry.id}`);
    previews[documentEntry.path] = await readFile(source.absolutePath, "utf8");
  }
  return previews;
}

async function assertNewPageTargetsAbsent(projectRoot, pageEntry) {
  const conflicts = [];
  for (const [relativePath, label] of [
    [pageEntry.annotationFile, "new annotation target"],
    [pageEntry.viewFile, "new view target"]
  ]) {
    const target = await assertSafeProjectFile(projectRoot, relativePath, label, { allowMissing: true });
    if (target.exists) conflicts.push(relativePath);
  }
  if (conflicts.length) {
    throw new Error(`New page permanent annotation or view path already exists: ${conflicts.join(", ")}`);
  }
}

async function verifyInstalledProject(projectRoot, manifest) {
  validateManifestV2(manifest);
  const sdkAbsolute = path.join(projectRoot, ...SDK_PATH.split("/"));
  const installedSdk = await readFile(sdkAbsolute);
  if (sha256(installedSdk) !== manifest.project.sdk.sha256) throw new Error("Installed SDK checksum does not match manifest");
  if (readSdkVersion(installedSdk) !== manifest.project.sdk.version) {
    throw new Error("Installed SDK version banner does not match manifest");
  }

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
    if (!pageEntry.display.enabled) {
      if (integrations.length !== 0) throw new Error(`disabled page ${pageEntry.id} must have zero PRD Annotator integrations`);
      continue;
    }
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

async function installProjectLocked({
  projectRoot,
  pagePaths,
  confirmInstall = false,
  confirmUpgrade = false,
  releaseClient,
  now,
  onChange,
  transactionHooks
} = {}) {
  if (confirmInstall !== true) throw new Error("--confirm-install is required");
  if (!projectRoot) throw new Error("projectRoot is required");
  if (!Array.isArray(pagePaths) || !pagePaths.length) throw new Error("At least one explicit --page is required");
  if (new Set(pagePaths).size !== pagePaths.length) throw new Error("Each --page selection must be unique");
  for (const pagePath of pagePaths) assertSafeSelectedPage(pagePath);

  const normalizedRoot = path.resolve(projectRoot);
  const rootStatus = await pathStatus(normalizedRoot);
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) throw new Error("projectRoot must be a non-symlink directory");
  const existingState = await readExistingManifest(normalizedRoot, { confirmUpgrade });
  const existingManifest = existingState.manifest;
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
    const htmlBytes = await readFile(absolutePath);
    const html = htmlBytes.toString("utf8");
    const integrations = inspectIntegration(html);
    if (integrations.length > 1) throw new Error("HTML contains more than one PRD Annotator script");
    selected.push({ htmlPath, absolutePath, htmlBytes, html, integration: integrations[0] || null });
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

  for (const { pageEntry, priorById } of selectedEntries) {
    if (!priorById) await assertNewPageTargetsAbsent(normalizedRoot, pageEntry);
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
  let installedSdkBytes = existingState.orphanSdkBytes;
  if (existingManifest) {
    const sdkAbsolute = path.join(normalizedRoot, ...SDK_PATH.split("/"));
    const status = await pathStatus(sdkAbsolute);
    if (!status?.isFile() || status.isSymbolicLink()) throw new Error("Installed SDK recorded by manifest is missing or unsafe");
    installedSdkBytes = await readFile(sdkAbsolute);
  }
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
    if (sha256(installedSdkBytes) !== sdkMetadata.sha256) throw new Error("Installed SDK checksum does not match manifest");
    if (readSdkVersion(installedSdkBytes) !== sdkMetadata.version) {
      throw new Error("Installed SDK version banner does not match manifest");
    }
  }

  const manifest = {
    schemaVersion: 2,
    project: { id: projectId, sdk: sdkMetadata },
    pages,
    documents: existingManifest?.documents || [],
    migration: existingManifest?.migration ?? null
  };
  validateManifestV2(manifest);

  const sdkOperations = sdkBytes ? [makeProjectOperation(normalizedRoot, SDK_PATH, sdkBytes, {
    expectedBeforeImage: installedSdkBytes
  })] : [];
  const dataOperations = [];
  const htmlOperations = [];
  const retainedAnnotationBytes = new Map();
  const retainedViewBytes = new Map();
  let previews;
  const documentIds = new Set(manifest.documents.map((documentEntry) => documentEntry.id));
  for (const { pageEntry, priorById } of selectedEntries) {
    if (!priorById) continue;
    const annotationFile = await assertSafeProjectFile(normalizedRoot, pageEntry.annotationFile, "existing annotation");
    const viewFile = await assertSafeProjectFile(normalizedRoot, pageEntry.viewFile, "existing view");
    const identityChanged = !samePageIdentity(makePageData(priorById), makePageData(pageEntry));
    if (!identityChanged) continue;
    retainedAnnotationBytes.set(pageEntry.annotationFile, await readFile(annotationFile.absolutePath));
    retainedViewBytes.set(pageEntry.viewFile, await readFile(viewFile.absolutePath));
  }
  for (const { selection, pageEntry, priorById } of selectedEntries) {
    const pageData = makePageData(pageEntry);
    const priorPageData = priorById ? makePageData(priorById) : null;
    const identityChanged = priorPageData && !samePageIdentity(priorPageData, pageData);
    let document;
    let annotationBeforeImage = null;
    let viewBeforeImage = null;
    if (priorById) {
      if (identityChanged) {
        try {
          annotationBeforeImage = retainedAnnotationBytes.get(pageEntry.annotationFile);
          viewBeforeImage = retainedViewBytes.get(pageEntry.viewFile);
          document = JSON.parse(annotationBeforeImage.toString("utf8"));
        } catch (error) {
          throw new Error(`Invalid existing annotation JSON: ${error.message}`);
        }
        validateCompleteAnnotationDocument(document, { label: `existing annotation ${pageEntry.id}`, documentIds });
        if (
          document.projectId !== projectId
          || !samePageIdentity(document.page, priorPageData)
        ) {
          throw new Error(`Existing annotation identity does not match manifest for ${pageEntry.id}`);
        }
        const route = document.page.route === `/${priorPageData.htmlPath}`
          ? `/${pageData.htmlPath}`
          : document.page.route;
        document = { ...structuredClone(document), projectId, page: { ...pageData, route } };
        validateCompleteAnnotationDocument(document, { label: `updated annotation ${pageEntry.id}`, documentIds });
      }
    } else {
      document = createEmptyAnnotationDocument({ projectId, page: pageData });
    }
    if (document) {
      previews ||= await collectDocumentPreviews(normalizedRoot, existingManifest, retainedViewBytes);
      dataOperations.push(makeProjectOperation(
        normalizedRoot,
        pageEntry.annotationFile,
        `${JSON.stringify(document, null, 2)}\n`,
        { expectedBeforeImage: annotationBeforeImage }
      ));
      dataOperations.push(makeProjectOperation(
        normalizedRoot,
        pageEntry.viewFile,
        serializeViewBundle(buildViewBundle({
          manifest,
          page: pageEntry,
          annotationDocument: document,
          documents: manifest.documents,
          previews,
          generatedAt: timestamp
        })),
        { expectedBeforeImage: viewBeforeImage }
      ));
    }
    const html = upsertIntegration(selection.html, {
      src: relativeWebPath(pageEntry.htmlPath, SDK_PATH),
      projectId,
      pageId: pageEntry.id,
      viewSrc: relativeWebPath(pageEntry.htmlPath, pageEntry.viewFile)
    });
    if (priorById && priorById.annotationFile !== pageEntry.annotationFile) throw new Error("Existing annotation path cannot be changed");
    htmlOperations.push(makeProjectOperation(normalizedRoot, pageEntry.htmlPath, html, {
      expectedBeforeImage: selection.htmlBytes
    }));
  }
  const manifestOperation = makeProjectOperation(
    normalizedRoot,
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { expectedBeforeImage: existingState.manifestBytes }
  );
  const operations = [...sdkOperations, ...dataOperations, manifestOperation, ...htmlOperations];

  await applyProjectTransaction({
    projectRoot: normalizedRoot,
    operations,
    transactionHooks: {
      ...transactionHooks,
      async afterCommit(info) {
        await transactionHooks?.afterCommit?.(info);
        onChange?.(info.relativePath);
      }
    },
    verify: () => verifyInstalledProject(normalizedRoot, manifest)
  });
  return manifest;
}

export async function installProject({
  projectRoot,
  pagePaths,
  confirmInstall = false,
  confirmUpgrade = false,
  releaseClient,
  now,
  onChange,
  transactionHooks = {},
  projectLock,
  projectLockOptions = {},
  onWarning
} = {}) {
  if (confirmInstall !== true) throw new Error("--confirm-install is required");
  if (!projectRoot) throw new Error("projectRoot is required");
  if (!Array.isArray(pagePaths) || !pagePaths.length) throw new Error("At least one explicit --page is required");
  if (new Set(pagePaths).size !== pagePaths.length) throw new Error("Each --page selection must be unique");
  for (const pagePath of pagePaths) assertSafeSelectedPage(pagePath);
  if (
    !transactionHooks
    || typeof transactionHooks !== "object"
    || Array.isArray(transactionHooks)
    || (transactionHooks.afterCommit !== undefined && typeof transactionHooks.afterCommit !== "function")
  ) throw new Error("Invalid transactionHooks");
  const normalizedRoot = path.resolve(projectRoot);
  return withProjectMutationLock(
    normalizedRoot,
    () => installProjectLocked({
      projectRoot: normalizedRoot,
      pagePaths,
      confirmInstall,
      confirmUpgrade,
      releaseClient,
      now,
      onChange,
      transactionHooks
    }),
    { lease: projectLock, lockOptions: projectLockOptions, onWarning }
  );
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
  transactionHooks,
  projectLockOptions,
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
      transactionHooks,
      projectLockOptions,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`),
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
