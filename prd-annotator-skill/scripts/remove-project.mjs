import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeProjectFile,
  checkProject
} from "./check-project.mjs";
import { inspectIntegration, removeIntegration } from "./lib/html.mjs";
import {
  canonicalJson,
  validateManifestV2
} from "./lib/schema.mjs";
import {
  mergeSnapshot,
  snapshotIdentity,
  validateSnapshotForPage
} from "./merge-annotations.mjs";
import { refreshProject } from "./refresh-project.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: remove-project.mjs --project-root PATH --confirm-remove --page PAGE_ID [--page PAGE_ID ...] --snapshot PATH [--snapshot PATH ...]";
const SNAPSHOT_FLOW = [
  "1. Keep the PRD Annotator display layer mounted on the target page.",
  "2. In the browser console, copy JSON.stringify(window.PRDAnnotator.getSnapshot(), null, 2).",
  "3. Save that exact copied object, or the exact delimited sync-prompt payload object, as temporary JSON.",
  "4. Repeat the capture once for every target page.",
  "5. Re-run this command with one --snapshot PATH argument per page."
].join("\n");

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNow(now) {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) fail("now must produce a valid date");
  return date.toISOString();
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readAuthorizedText(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  return readFile(absolutePath, "utf8");
}

async function readAuthorizedJson(projectRoot, relativePath, label) {
  try {
    return JSON.parse(await readAuthorizedText(projectRoot, relativePath, label));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`Invalid ${label} JSON: ${error.message}`);
    throw error;
  }
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) fail(USAGE);
  const result = {
    projectRoot: undefined,
    confirmRemove: false,
    pageIds: [],
    snapshotPaths: []
  };
  for (let index = 0; index < argv.length;) {
    const flag = argv[index];
    if (flag === "--confirm-remove") {
      if (result.confirmRemove) fail(USAGE);
      result.confirmRemove = true;
      index += 1;
      continue;
    }
    if (!["--project-root", "--page", "--snapshot"].includes(flag)) fail(USAGE);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(USAGE);
    if (flag === "--project-root") {
      if (result.projectRoot !== undefined) fail(USAGE);
      result.projectRoot = value;
    } else if (flag === "--page") {
      result.pageIds.push(value);
    } else {
      result.snapshotPaths.push(value);
    }
    index += 2;
  }
  if (!result.projectRoot || !result.pageIds.length) fail(USAGE);
  return result;
}

async function readSnapshotFile(snapshotPath) {
  const absolutePath = path.resolve(String(snapshotPath || ""));
  const status = await pathStatus(absolutePath);
  if (!status?.isFile() || status.isSymbolicLink()) fail("Invalid snapshot file");
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    fail(`Invalid snapshot JSON: ${error.message}`);
  }
}

function validateTransactionHooks(transactionHooks) {
  const hookNames = [
    "afterBackup",
    "afterCommit",
    "beforeCleanup",
    "beforeCommit",
    "beforeRecoveryInventory",
    "beforeRollback"
  ];
  if (!isRecord(transactionHooks)) fail("Invalid transactionHooks");
  for (const [name, value] of Object.entries(transactionHooks)) {
    if (!hookNames.includes(name) || typeof value !== "function") fail("Invalid transactionHooks");
  }
  return transactionHooks;
}

function observeWarning(onWarning, warning) {
  try {
    onWarning?.(warning);
  } catch {
    // Warning observers cannot turn a verified commit into a false failure.
  }
}

function missingSnapshot(pageId) {
  return `Current annotation snapshot is required for ${pageId}\n${SNAPSHOT_FLOW}`;
}

function matchTargetSnapshots({ manifest, pages, snapshots }) {
  if (!Array.isArray(snapshots)) fail("snapshots must be an array");
  const targetIds = new Set(pages.map((page) => page.id));
  const byPageId = new Map(pages.map((page) => [page.id, []]));
  for (const snapshot of snapshots) {
    let identity;
    try {
      identity = snapshotIdentity(snapshot);
    } catch {
      fail("Snapshot project/page identity does not match the removal target");
    }
    if (identity.projectId !== manifest.project.id || !targetIds.has(identity.pageId)) {
      fail("Snapshot project/page identity does not match the removal target");
    }
    byPageId.get(identity.pageId).push(snapshot);
  }
  const matched = new Map();
  for (const page of pages) {
    const candidates = byPageId.get(page.id);
    if (candidates.length === 0) fail(missingSnapshot(page.id));
    if (candidates.length !== 1) {
      fail(`Exactly one current annotation snapshot is required for ${page.id}`);
    }
    matched.set(page.id, candidates[0]);
  }
  return matched;
}

function assertSnapshotRetention({ before, live, permanent, annotationPath }) {
  const beforeById = new Map(before.annotations.map((annotation) => [annotation.id, annotation]));
  const liveById = new Map(live.annotations.map((annotation) => [annotation.id, annotation]));
  const permanentById = new Map(permanent.annotations.map((annotation) => [annotation.id, annotation]));
  for (const [id, original] of beforeById) {
    const retained = permanentById.get(id);
    if (!retained) fail(`${annotationPath}: permanent annotation ${id} was lost`);
    if (!liveById.has(id) && canonicalJson(retained) !== canonicalJson(original)) {
      fail(`${annotationPath}: permanent-only annotation ${id} was changed`);
    }
  }
  for (const [id, annotation] of liveById) {
    const retained = permanentById.get(id);
    if (!retained) fail(`${annotationPath}: live annotation ${id} was not persisted`);
    if (Date.parse(retained.updatedAt) < Date.parse(annotation.updatedAt)) {
      fail(`${annotationPath}: live annotation ${id} is newer than permanent JSON`);
    }
  }
}

async function captureBytes(projectRoot, paths) {
  const result = new Map();
  for (const relativePath of paths) {
    const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, "removal change path");
    result.set(relativePath, await readFile(absolutePath));
  }
  return result;
}

function makeOperation(projectRoot, relativePath, data, expectedData) {
  return {
    relativePath,
    absolutePath: path.resolve(projectRoot, ...relativePath.split("/")),
    data,
    expectedData: Buffer.from(expectedData)
  };
}

async function rollbackOperation(operation, transactionHooks) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await transactionHooks.beforeRollback?.({
        attempt,
        relativePath: operation.relativePath
      });
      await assertSafeProjectFile(
        operation.projectRoot,
        operation.relativePath,
        "removal rollback target",
        { allowMissing: true }
      );
      const status = await pathStatus(operation.absolutePath);
      if (status) {
        const current = await readFile(operation.absolutePath);
        if (current.equals(operation.expectedData)) return null;
        if (!current.equals(Buffer.from(operation.data))) {
          throw new Error(`${operation.relativePath} changed after removal commit`);
        }
        const failedPath = `${operation.backupPath}.failed-new-${attempt}`;
        await rename(operation.absolutePath, failedPath);
        try {
          await assertSafeProjectFile(
            operation.projectRoot,
            operation.relativePath,
            "removal rollback target",
            { allowMissing: true }
          );
          await link(operation.backupPath, operation.absolutePath);
        } catch (error) {
          await rename(failedPath, operation.absolutePath).catch(() => {});
          throw error;
        }
      } else {
        await link(operation.backupPath, operation.absolutePath);
      }
      const restored = await readFile(operation.absolutePath);
      if (!restored.equals(operation.expectedData)) {
        throw new Error(`${operation.relativePath} rollback verification failed`);
      }
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
}

async function applyRemovalTransaction(projectRoot, operations, verify, transactionHooks, onWarning) {
  const stagingRoot = path.join(
    projectRoot,
    `.prd-annotator-remove-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const prepared = [];
  const committed = [];
  let transactionError;
  let retainRecovery = false;
  try {
    for (const operation of operations) {
      await assertSafeProjectFile(projectRoot, operation.relativePath, "removal target");
    }
    await mkdir(stagingRoot, { recursive: false });
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const stagePath = path.join(stagingRoot, `new-${index}`);
      const backupPath = path.join(stagingRoot, `backup-${index}`);
      await writeFile(stagePath, operation.data);
      prepared.push({ ...operation, projectRoot, stagePath, backupPath });
    }
    for (let index = 0; index < prepared.length; index += 1) {
      const operation = prepared[index];
      await transactionHooks.beforeCommit?.({ relativePath: operation.relativePath, index });
      await assertSafeProjectFile(projectRoot, operation.relativePath, "removal target");
      const current = await readFile(operation.absolutePath);
      if (!current.equals(operation.expectedData)) {
        fail(`${operation.relativePath} changed during display removal`);
      }
      await rename(operation.absolutePath, operation.backupPath);
      committed.push(operation);
      await transactionHooks.afterBackup?.({ relativePath: operation.relativePath, index });
      await assertSafeProjectFile(
        projectRoot,
        operation.relativePath,
        "removal target",
        { allowMissing: true }
      );
      await link(operation.stagePath, operation.absolutePath);
      await rm(operation.stagePath, { force: true });
      await transactionHooks.afterCommit?.({ relativePath: operation.relativePath, index });
    }
    await verify();
  } catch (error) {
    transactionError = error;
    const rollbackFailures = [];
    for (const operation of [...committed].reverse()) {
      const rollbackError = await rollbackOperation(operation, transactionHooks);
      if (rollbackError) rollbackFailures.push(`${operation.relativePath}: ${rollbackError.message}`);
    }
    if (rollbackFailures.length) {
      retainRecovery = true;
      transactionError = new Error(
        `${error.message}; rollback incomplete; recovery retained at ${stagingRoot}: ${rollbackFailures.join("; ")}`
      );
    }
  }

  const retainedFiles = [];
  if (!retainRecovery) {
    let cleanupError;
    let cleaned = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await transactionHooks.beforeCleanup?.({ attempt, stagingRoot });
        await rm(stagingRoot, { recursive: true, force: true });
        cleaned = true;
        break;
      } catch (error) {
        cleanupError = error;
      }
    }
    if (!cleaned) {
      observeWarning(
        onWarning,
        `Failed to clean removal staging directory: ${stagingRoot}: ${cleanupError.message}`
      );
      try {
        await transactionHooks.beforeRecoveryInventory?.({ stagingRoot });
        for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
          if (entry.isFile()) {
            retainedFiles.push(path.relative(projectRoot, path.join(stagingRoot, entry.name)).split(path.sep).join("/"));
          }
        }
      } catch (error) {
        observeWarning(
          onWarning,
          `Failed to inspect retained removal files: ${stagingRoot}: ${error.message}`
        );
        for (const operation of prepared) {
          retainedFiles.push(path.relative(projectRoot, operation.backupPath).split(path.sep).join("/"));
        }
      }
    }
  }
  if (transactionError) throw transactionError;
  return { retainedFiles };
}

export async function removeProject({
  projectRoot,
  pageIds,
  snapshots,
  confirmRemove,
  now,
  transactionHooks = {},
  projectLockOptions = {},
  onWarning
} = {}) {
  if (confirmRemove !== true) fail("--confirm-remove is required");
  if (!Array.isArray(pageIds) || !pageIds.length) fail("At least one explicit --page is required");
  if (new Set(pageIds).size !== pageIds.length) fail("Each --page selection must be unique");
  if (!projectRoot) fail("projectRoot is required");
  if (!Array.isArray(snapshots)) fail("snapshots must be an array");
  if (onWarning !== undefined && typeof onWarning !== "function") fail("Invalid onWarning");
  const validatedHooks = validateTransactionHooks(transactionHooks);
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const manifest = await readAuthorizedJson(normalizedRoot, MANIFEST_PATH, "manifest");
  validateManifestV2(manifest);
  const pages = pageIds.map((pageId) => {
    const page = manifest.pages.find((entry) => entry.id === pageId);
    if (!page) fail(`Page is not authorized by manifest: ${pageId}`);
    return page;
  });
  const matchedSnapshots = matchTargetSnapshots({ manifest, pages, snapshots });
  const liveDocuments = new Map();
  for (const page of pages) {
    try {
      liveDocuments.set(page.id, validateSnapshotForPage({
        snapshot: matchedSnapshots.get(page.id),
        manifest,
        page
      }));
    } catch (error) {
      if (/projectId|page\.id|payload pageId/.test(error.message)) {
        fail("Snapshot project/page identity does not match the removal target");
      }
      throw error;
    }
  }

  return withProjectMutationLock(normalizedRoot, async (projectLock) => {
    const lockedManifest = await readAuthorizedJson(normalizedRoot, MANIFEST_PATH, "manifest");
    validateManifestV2(lockedManifest);
    if (canonicalJson(lockedManifest) !== canonicalJson(manifest)) {
      fail(`${MANIFEST_PATH} changed before display removal`);
    }
    const trackedPaths = [...new Set([
      MANIFEST_PATH,
      ...manifest.pages.flatMap((page) => [page.annotationFile, page.viewFile]),
      ...pages.map((page) => page.htmlPath)
    ])];
    const bytesBefore = await captureBytes(normalizedRoot, trackedPaths);
    const permanentBefore = new Map();
    for (const page of pages) {
      permanentBefore.set(page.id, await readAuthorizedJson(
        normalizedRoot,
        page.annotationFile,
        "annotation file"
      ));
    }

    for (const page of pages) {
      await mergeSnapshot({
        projectRoot: normalizedRoot,
        snapshot: matchedSnapshots.get(page.id),
        projectLock,
        onWarning
      });
      const permanent = await readAuthorizedJson(normalizedRoot, page.annotationFile, "annotation file");
      assertSnapshotRetention({
        before: permanentBefore.get(page.id),
        live: liveDocuments.get(page.id),
        permanent,
        annotationPath: page.annotationFile
      });
    }

    await refreshProject({ projectRoot: normalizedRoot, now, projectLock, onWarning });
    await checkProject({ projectRoot: normalizedRoot });
    const synchronizedBytes = await captureBytes(normalizedRoot, trackedPaths);

    const currentManifestSource = await readAuthorizedText(normalizedRoot, MANIFEST_PATH, "manifest");
    let currentManifest;
    try {
      currentManifest = JSON.parse(currentManifestSource);
    } catch (error) {
      fail(`Invalid manifest JSON: ${error.message}`);
    }
    validateManifestV2(currentManifest);
    const htmlOperations = [];
    for (const pageId of pageIds) {
      const page = currentManifest.pages.find((entry) => entry.id === pageId);
      if (!page) fail(`Page is not authorized by manifest: ${pageId}`);
      const html = await readAuthorizedText(normalizedRoot, page.htmlPath, "HTML file");
      const integrations = inspectIntegration(html);
      if (integrations.length !== 1) {
        fail(`${page.htmlPath} must contain exactly one PRD Annotator integration before removal`);
      }
      const [integration] = integrations;
      if (integration.projectId !== currentManifest.project.id || integration.pageId !== page.id) {
        fail(`${page.htmlPath} integration identity does not match manifest`);
      }
      htmlOperations.push(makeOperation(
        normalizedRoot,
        page.htmlPath,
        removeIntegration(html),
        Buffer.from(html)
      ));
    }

    const displayTimestamp = normalizeNow(now);
    const removedManifest = structuredClone(currentManifest);
    for (const pageId of pageIds) {
      const page = removedManifest.pages.find((entry) => entry.id === pageId);
      page.display = { enabled: false, updatedAt: displayTimestamp };
    }
    validateManifestV2(removedManifest);
    const manifestOperation = makeOperation(
      normalizedRoot,
      MANIFEST_PATH,
      `${JSON.stringify(removedManifest, null, 2)}\n`,
      Buffer.from(currentManifestSource)
    );
    const removalOperations = [...htmlOperations, manifestOperation];
    const synchronizedPaths = manifest.pages.flatMap((page) => [page.annotationFile, page.viewFile]);
    const transactionResult = await applyRemovalTransaction(
      normalizedRoot,
      removalOperations,
      async () => {
        await checkProject({ projectRoot: normalizedRoot });
        const finalSynchronizedBytes = await captureBytes(normalizedRoot, synchronizedPaths);
        for (const relativePath of synchronizedPaths) {
          if (!finalSynchronizedBytes.get(relativePath).equals(synchronizedBytes.get(relativePath))) {
            fail(`${relativePath} changed during final removal gate`);
          }
        }
      },
      validatedHooks,
      onWarning
    );

    const changedFiles = new Set(trackedPaths.filter(
      (relativePath) => !bytesBefore.get(relativePath).equals(synchronizedBytes.get(relativePath))
    ));
    for (const operation of removalOperations) {
      if (!Buffer.from(operation.data).equals(operation.expectedData)) {
        changedFiles.add(operation.relativePath);
      }
    }
    for (const relativePath of transactionResult.retainedFiles) changedFiles.add(relativePath);
    return { removedPages: [...pageIds], changedFiles: [...changedFiles].sort() };
  }, { lockOptions: projectLockOptions, onWarning });
}

export async function runRemoveProjectCli({
  argv,
  now,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  try {
    const options = parseArguments(argv || []);
    const snapshots = [];
    for (const snapshotPath of options.snapshotPaths) {
      snapshots.push(await readSnapshotFile(snapshotPath));
    }
    const result = await removeProject({
      projectRoot: options.projectRoot,
      pageIds: options.pageIds,
      snapshots,
      confirmRemove: options.confirmRemove,
      now,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`)
    });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error.message === USAGE ? USAGE : error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runRemoveProjectCli({ argv: process.argv.slice(2) });
}
