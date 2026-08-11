import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeProjectFile,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import { DOCUMENT_FORMATS } from "./lib/documents.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import {
  applyProjectTransaction,
  makeProjectOperation,
  normalizeNow
} from "./lib/project-transaction.mjs";
import { deriveRoutePageId, assertValidRoute } from "./lib/route.mjs";
import {
  buildRouteRegistry,
  serializeRouteRegistry
} from "./lib/route-registry.mjs";
import {
  createEmptyAnnotationDocument,
  normalizePageIdentity,
  validateManifestV2
} from "./lib/schema.mjs";
import { buildViewBundle, serializeViewBundle } from "./lib/view.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: set-routes.mjs --project-root PATH --html PATH --routes PATH --confirm-route-write";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function assertRouteInput(routes) {
  if (!Array.isArray(routes)) throw new Error("routes must be an array");
  const patterns = new Set();
  return routes.map((route, index) => {
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      throw new Error(`Invalid routes[${index}]`);
    }
    const keys = Object.keys(route).sort();
    if (keys.length !== 2 || keys[0] !== "routePattern" || keys[1] !== "title") {
      throw new Error(`Invalid routes[${index}] fields`);
    }
    if (typeof route.title !== "string" || !route.title.trim() || route.title !== route.title.trim()) {
      throw new Error(`Invalid routes[${index}].title`);
    }
    const routePattern = assertValidRoute(route.routePattern, `routes[${index}].routePattern`);
    if (patterns.has(routePattern)) throw new Error(`Duplicate route pattern: ${routePattern}`);
    patterns.add(routePattern);
    return { title: route.title, routePattern };
  });
}

function compareRouteInput(left, right) {
  return left.routePattern < right.routePattern
    ? -1
    : left.routePattern > right.routePattern
      ? 1
      : 0;
}

function parseViewSource(source) {
  for (const prefix of [
    "window.PRDAnnotator.hydrateView(",
    "window.PRDAnnotator.registerView("
  ]) {
    if (!source.startsWith(prefix) || !source.endsWith(");\n")) continue;
    try {
      return JSON.parse(source.slice(prefix.length, -3));
    } catch {
      return null;
    }
  }
  return null;
}

async function collectDocumentPreviews(projectRoot, manifest, basePage) {
  const previews = {};
  const baseView = await assertSafeProjectFile(
    projectRoot,
    basePage.viewFile,
    "base page view"
  );
  const bundle = parseViewSource(await readFile(baseView.absolutePath, "utf8"));
  for (const entry of bundle?.documents || []) {
    if (entry.previewStatus === "available" && typeof entry.content === "string") {
      previews[entry.path] = entry.content;
    }
  }
  for (const entry of manifest.documents) {
    if (entry.missing || !DOCUMENT_FORMATS.text.has(entry.format)) continue;
    const source = await assertSafeProjectFile(
      projectRoot,
      entry.path,
      `document source ${entry.id}`
    );
    previews[entry.path] = await readFile(source.absolutePath, "utf8");
  }
  return previews;
}

async function assertNewRouteTargetsAbsent(projectRoot, page) {
  for (const [relativePath, label] of [
    [page.annotationFile, "new route annotation target"],
    [page.viewFile, "new route view target"]
  ]) {
    const target = await assertSafeProjectFile(projectRoot, relativePath, label, { allowMissing: true });
    if (target.exists) throw new Error(`New route data path already exists: ${relativePath}`);
  }
}

async function verifyRouteWrite({ projectRoot, manifest, basePage, registrySource, newPages }) {
  const manifestFile = await assertSafeProjectFile(projectRoot, MANIFEST_PATH, "manifest");
  const installedManifest = JSON.parse(await readFile(manifestFile.absolutePath, "utf8"));
  validateManifestV2(installedManifest);
  if (JSON.stringify(installedManifest) !== JSON.stringify(manifest)) {
    throw new Error("Installed route manifest does not match planned manifest");
  }
  const registryFile = await assertSafeProjectFile(
    projectRoot,
    basePage.routeRegistryFile,
    "route registry"
  );
  if (await readFile(registryFile.absolutePath, "utf8") !== registrySource) {
    throw new Error("Installed route registry does not match planned registry");
  }
  const documentIds = new Set(manifest.documents.map((entry) => entry.id));
  for (const page of newPages) {
    const annotationFile = await assertSafeProjectFile(
      projectRoot,
      page.annotationFile,
      "new route annotation"
    );
    const document = JSON.parse(await readFile(annotationFile.absolutePath, "utf8"));
    validateCompleteAnnotationDocument(document, {
      label: `new route annotation ${page.id}`,
      documentIds
    });
    if (document.projectId !== manifest.project.id || document.page.id !== page.id) {
      throw new Error(`New route annotation identity mismatch for ${page.id}`);
    }
    await assertSafeProjectFile(projectRoot, page.viewFile, "new route view");
  }
}

async function setProjectRoutesLocked({
  projectRoot,
  htmlPath,
  routes,
  now,
  onChange,
  transactionHooks
}) {
  const manifestFile = await assertSafeProjectFile(projectRoot, MANIFEST_PATH, "manifest");
  const manifestBytes = await readFile(manifestFile.absolutePath);
  let existingManifest;
  try {
    existingManifest = JSON.parse(manifestBytes.toString("utf8"));
    validateManifestV2(existingManifest);
  } catch (error) {
    throw new Error(`Invalid existing manifest: ${error.message}`);
  }
  const physicalPages = existingManifest.pages.filter((page) => page.htmlPath === htmlPath);
  const basePages = physicalPages.filter((page) => normalizePageIdentity(page).mode === "document");
  if (basePages.length !== 1) throw new Error(`Expected one installed document page for ${htmlPath}`);
  const existingBase = basePages[0];
  if (!existingBase.display.enabled) throw new Error(`Document page is not enabled for ${htmlPath}`);
  await assertSafeProjectFile(projectRoot, existingBase.htmlPath, "base HTML");
  const baseAnnotation = await assertSafeProjectFile(
    projectRoot,
    existingBase.annotationFile,
    "base annotation"
  );
  await readFile(baseAnnotation.absolutePath);

  const timestamp = normalizeNow(now);
  const normalizedRoutes = assertRouteInput(routes).sort(compareRouteInput);
  const usedIds = new Set(existingManifest.pages.map((page) => page.id));
  const existingRoutes = new Map(physicalPages
    .filter((page) => normalizePageIdentity(page).mode === "hash-route")
    .map((page) => [normalizePageIdentity(page).routePattern, page]));
  if (normalizedRoutes.length === 0 && existingRoutes.size === 0) {
    return existingManifest;
  }
  const newPages = [];
  const requestedPages = [];

  for (const route of normalizedRoutes) {
    const existing = existingRoutes.get(route.routePattern);
    if (existing) {
      await assertSafeProjectFile(projectRoot, existing.annotationFile, "existing route annotation");
      await assertSafeProjectFile(projectRoot, existing.viewFile, "existing route view");
      requestedPages.push(existing.display.enabled
        ? clone(existing)
        : {
            ...clone(existing),
            display: { enabled: true, updatedAt: timestamp }
          });
      continue;
    }
    const id = deriveRoutePageId(htmlPath, route.routePattern, usedIds);
    const page = {
      id,
      title: route.title,
      htmlPath,
      identity: { mode: "hash-route", routePattern: route.routePattern },
      annotationFile: `.prd-annotator/data/pages/${id}.json`,
      viewFile: `.prd-annotator/view/pages/${id}.js`,
      display: { enabled: true, updatedAt: timestamp }
    };
    await assertNewRouteTargetsAbsent(projectRoot, page);
    newPages.push(page);
    requestedPages.push(page);
  }

  const existingBaseIndex = existingManifest.pages.findIndex((page) => page.id === existingBase.id);
  const nextPages = existingManifest.pages.map((page) => {
    if (page.id === existingBase.id) {
      return {
        ...clone(page),
        identity: { mode: "document" },
        routeRegistryFile: `.prd-annotator/view/routes/${page.id}.js`
      };
    }
    if (page.htmlPath !== htmlPath || normalizePageIdentity(page).mode !== "hash-route") {
      return clone(page);
    }
    const requested = requestedPages.find((entry) => entry.id === page.id);
    if (requested) return requested;
    return page.display.enabled
      ? { ...clone(page), display: { enabled: false, updatedAt: timestamp } }
      : clone(page);
  });
  nextPages.splice(existingBaseIndex + 1, 0, ...newPages);
  const manifest = { ...clone(existingManifest), pages: nextPages };
  validateManifestV2(manifest);
  const basePage = manifest.pages.find((page) => page.id === existingBase.id);
  const registrySource = serializeRouteRegistry(buildRouteRegistry({ manifest, basePage }));
  const registryState = await assertSafeProjectFile(
    projectRoot,
    basePage.routeRegistryFile,
    "route registry",
    { allowMissing: true }
  );
  const registryBefore = registryState.exists
    ? await readFile(registryState.absolutePath)
    : null;
  const previews = await collectDocumentPreviews(projectRoot, manifest, basePage);
  const operations = [];
  for (const page of newPages) {
    const annotationDocument = createEmptyAnnotationDocument({
      projectId: manifest.project.id,
      page: {
        id: page.id,
        title: page.title,
        htmlPath: page.htmlPath,
        route: page.identity.routePattern
      }
    });
    operations.push(makeProjectOperation(
      projectRoot,
      page.annotationFile,
      `${JSON.stringify(annotationDocument, null, 2)}\n`,
      { expectedBeforeImage: null }
    ));
    operations.push(makeProjectOperation(
      projectRoot,
      page.viewFile,
      serializeViewBundle(buildViewBundle({
        manifest,
        page,
        annotationDocument,
        documents: manifest.documents,
        previews,
        generatedAt: timestamp
      })),
      { expectedBeforeImage: null }
    ));
  }
  operations.push(makeProjectOperation(
    projectRoot,
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { expectedBeforeImage: manifestBytes }
  ));
  operations.push(makeProjectOperation(
    projectRoot,
    basePage.routeRegistryFile,
    registrySource,
    { expectedBeforeImage: registryBefore }
  ));

  await applyProjectTransaction({
    projectRoot,
    operations,
    transactionHooks: {
      ...transactionHooks,
      async afterCommit(info) {
        await transactionHooks?.afterCommit?.(info);
        onChange?.(info.relativePath);
      }
    },
    verify: () => verifyRouteWrite({
      projectRoot,
      manifest,
      basePage,
      registrySource,
      newPages
    })
  });
  return manifest;
}

export async function setProjectRoutes({
  projectRoot,
  htmlPath,
  routes,
  confirmRouteWrite = false,
  now,
  onChange,
  transactionHooks = {},
  projectLock,
  projectLockOptions = {},
  onWarning
} = {}) {
  if (confirmRouteWrite !== true) throw new Error("--confirm-route-write is required");
  if (!projectRoot) throw new Error("projectRoot is required");
  if (typeof htmlPath !== "string" || !htmlPath) throw new Error("htmlPath is required");
  if (!transactionHooks || typeof transactionHooks !== "object" || Array.isArray(transactionHooks)) {
    throw new Error("Invalid transactionHooks");
  }
  const normalizedRoot = path.resolve(projectRoot);
  return withProjectMutationLock(
    normalizedRoot,
    () => setProjectRoutesLocked({
      projectRoot: normalizedRoot,
      htmlPath,
      routes,
      now,
      onChange,
      transactionHooks
    }),
    { lease: projectLock, lockOptions: projectLockOptions, onWarning }
  );
}

function parseArguments(argv) {
  if (
    argv.length !== 7
    || argv[0] !== "--project-root"
    || !argv[1]
    || argv[2] !== "--html"
    || !argv[3]
    || argv[4] !== "--routes"
    || !argv[5]
    || argv[6] !== "--confirm-route-write"
  ) {
    throw new Error(USAGE);
  }
  return {
    projectRoot: argv[1],
    htmlPath: argv[3],
    routesPath: argv[5],
    confirmRouteWrite: true
  };
}

async function readRouteFile(routesPath) {
  const absolutePath = path.resolve(routesPath);
  const status = await lstat(absolutePath);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("Route JSON must be a regular file");
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid route JSON: ${error.message}`);
  }
}

export async function runSetRoutesCli({
  argv,
  now,
  transactionHooks,
  projectLockOptions,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  try {
    const options = parseArguments(argv || []);
    const changedPaths = [];
    const manifest = await setProjectRoutes({
      projectRoot: options.projectRoot,
      htmlPath: options.htmlPath,
      routes: await readRouteFile(options.routesPath),
      confirmRouteWrite: options.confirmRouteWrite,
      now,
      transactionHooks,
      projectLockOptions,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`),
      onChange: (relativePath) => changedPaths.push(relativePath)
    });
    const basePage = manifest.pages.find((page) => (
      page.htmlPath === options.htmlPath
      && normalizePageIdentity(page).mode === "document"
    ));
    stdout.write(`${JSON.stringify({
      htmlPath: options.htmlPath,
      routeRegistryFile: basePage.routeRegistryFile,
      pageIds: manifest.pages
        .filter((page) => page.htmlPath === options.htmlPath)
        .map((page) => page.id),
      changedPaths
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message === USAGE ? USAGE : error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runSetRoutesCli({ argv: process.argv.slice(2) });
}
