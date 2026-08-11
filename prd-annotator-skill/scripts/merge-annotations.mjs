import { lstat, mkdir, readFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeProjectFile,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import {
  annotationFingerprintInput,
  canonicalJson,
  fingerprintValue,
  normalizeAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";
import { withProjectMutationLock } from "./lib/mutation-lock.mjs";
import {
  applyProjectTransaction,
  makeProjectOperation
} from "./lib/project-transaction.mjs";

const MANIFEST_PATH = ".prd-annotator/manifest.json";
const USAGE = "Usage: merge-annotations.mjs --project-root PATH --snapshot PATH";
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 10;
const LOCK_RELEASE_ATTEMPTS = 3;
const PROMPT_FIELDS = [
  "annotationPath",
  "document",
  "fingerprint",
  "htmlPath",
  "manifestPath",
  "pageId",
  "projectId",
  "viewPath"
];

function fail(message) {
  throw new Error(message);
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArguments(argv) {
  if (argv.length !== 4) fail(USAGE);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--project-root", "--snapshot"].includes(flag) || !value || value.startsWith("--")) fail(USAGE);
    if (Object.hasOwn(result, flag)) fail(`Duplicate argument: ${flag}`);
    result[flag] = value;
  }
  if (!result["--project-root"] || !result["--snapshot"]) fail(USAGE);
  return { projectRoot: result["--project-root"], snapshotPath: result["--snapshot"] };
}

async function readProjectJson(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

async function readProjectJsonWithBytes(projectRoot, relativePath, label) {
  const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, label);
  const bytes = await readFile(absolutePath);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

function identifySnapshot(snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.document)) {
    fail("snapshot must be a raw browser snapshot or extracted prompt payload JSON object");
  }
  const promptPayload = PROMPT_FIELDS.every((field) => Object.hasOwn(snapshot, field));
  const rawSnapshot = [1, 2].includes(snapshot.schemaVersion);
  if (!promptPayload && !rawSnapshot) {
    fail("snapshot must be a raw browser snapshot or extracted prompt payload JSON object");
  }
  return { promptPayload, rawSnapshot };
}

function validateTransactionHooks(transactionHooks) {
  const hookNames = ["beforeStageWrite", "beforeRename", "beforeLockRelease"];
  if (!isRecord(transactionHooks)) fail("Invalid transactionHooks");
  for (const [name, value] of Object.entries(transactionHooks)) {
    if (!hookNames.includes(name) || typeof value !== "function") fail("Invalid transactionHooks");
  }
  return transactionHooks;
}

function validateLockOptions(lockOptions) {
  if (!isRecord(lockOptions)) fail("Invalid lockOptions");
  const result = {
    timeoutMs: lockOptions.timeoutMs ?? LOCK_TIMEOUT_MS,
    retryMs: lockOptions.retryMs ?? LOCK_RETRY_MS,
    releaseRetryMs: lockOptions.releaseRetryMs ?? LOCK_RETRY_MS,
    releaseAttempts: lockOptions.releaseAttempts ?? LOCK_RELEASE_ATTEMPTS
  };
  if (
    !Number.isFinite(result.timeoutMs)
    || result.timeoutMs < 0
    || !Number.isFinite(result.retryMs)
    || result.retryMs < 0
    || !Number.isFinite(result.releaseRetryMs)
    || result.releaseRetryMs < 0
    || !Number.isInteger(result.releaseAttempts)
    || result.releaseAttempts < 1
  ) {
    fail("Invalid lockOptions");
  }
  return result;
}

function snapshotProjectIdentity(snapshot, kind) {
  let envelopeProjectId;
  if (kind.rawSnapshot && snapshot.schemaVersion === 1) {
    envelopeProjectId = snapshot.projectId || snapshot.projectKey;
  } else {
    if (
      typeof snapshot.projectId !== "string"
      || !snapshot.projectId.trim()
      || Object.hasOwn(snapshot, "projectKey")
    ) {
      fail("schema-v2 snapshot must use a non-empty projectId without projectKey");
    }
    envelopeProjectId = snapshot.projectId;
  }
  return envelopeProjectId;
}

function validateSnapshotProjectIdentity(snapshot, kind, manifest) {
  const envelopeProjectId = snapshotProjectIdentity(snapshot, kind);
  if (envelopeProjectId !== manifest.project.id) fail("snapshot projectId does not match manifest");
  return envelopeProjectId;
}

export function snapshotIdentity(snapshot) {
  const kind = identifySnapshot(snapshot);
  const projectId = snapshotProjectIdentity(snapshot, kind);
  const pageId = snapshot.document.page?.id;
  if (typeof pageId !== "string" || !pageId) fail("snapshot document page.id is required");
  if (kind.promptPayload && snapshot.pageId !== pageId) {
    fail("payload pageId does not match document page.id");
  }
  return { projectId, pageId };
}

function normalizeIncomingDocument(snapshot, manifest, page) {
  const defaults = {
    projectId: manifest.project.id,
    page: {
      id: page.id,
      title: page.title,
      htmlPath: page.htmlPath,
      route: `/${page.htmlPath}`
    }
  };
  if (snapshot.document.schemaVersion === 1) {
    return normalizeAnnotationDocument(snapshot.document, defaults);
  }
  if (snapshot.document.schemaVersion !== 2) fail("snapshot document schemaVersion must be 1 or 2");
  return clone(snapshot.document);
}

function validateSnapshotEnvelope(snapshot, kind, manifest, page, incoming) {
  if (kind.rawSnapshot && snapshot.schemaVersion !== snapshot.document.schemaVersion) {
    fail("snapshot schemaVersion does not match document schemaVersion");
  }
  validateSnapshotProjectIdentity(snapshot, kind, manifest);
  if (incoming.projectId !== manifest.project.id) fail("document projectId does not match manifest");
  if (incoming.page.id !== page.id) fail("snapshot page.id is not authorized by manifest");
  if (incoming.page.htmlPath !== page.htmlPath) fail("snapshot page.htmlPath does not match manifest");
  if (kind.promptPayload) {
    if (snapshot.manifestPath !== MANIFEST_PATH) fail("payload manifestPath does not match manifest");
    if (snapshot.pageId !== incoming.page.id) fail("payload pageId does not match document page.id");
    if (snapshot.annotationPath !== page.annotationFile) fail("payload annotationPath does not match manifest");
    if (snapshot.viewPath !== page.viewFile) fail("payload viewPath does not match manifest");
    if (snapshot.htmlPath !== page.htmlPath) fail("payload htmlPath does not match manifest");
    if (snapshot.fingerprint !== fingerprintValue(annotationFingerprintInput(incoming))) {
      fail("payload fingerprint does not match annotations");
    }
  }
  if (
    kind.rawSnapshot
    && snapshot.annotationFingerprint !== undefined
    && snapshot.annotationFingerprint !== fingerprintValue(annotationFingerprintInput(incoming))
  ) {
    fail("snapshot annotationFingerprint does not match annotations");
  }
}

export function validateSnapshotForPage({ snapshot, manifest, page } = {}) {
  validateManifestV2(manifest);
  if (!page || !manifest.pages.includes(page)) fail("Snapshot page is not authorized by manifest");
  const snapshotKind = identifySnapshot(snapshot);
  const incoming = normalizeIncomingDocument(snapshot, manifest, page);
  validateSnapshotEnvelope(snapshot, snapshotKind, manifest, page, incoming);
  const documentIds = new Set(manifest.documents.map((entry) => entry.id));
  validateCompleteAnnotationDocument(incoming, { documentIds });
  return incoming;
}

function mergeAnnotations(existing, incoming, annotationPath) {
  const normalizedExisting = normalizeAnnotationDocument(existing);
  const normalizedIncoming = normalizeAnnotationDocument(incoming, {
    projectId: normalizedExisting.projectId,
    page: normalizedExisting.page
  });
  const byId = new Map(
    normalizedExisting.annotations.map((annotation) => [annotation.id, clone(annotation)])
  );
  for (const candidate of normalizedIncoming.annotations) {
    const current = byId.get(candidate.id);
    if (!current) {
      byId.set(candidate.id, clone(candidate));
      continue;
    }
    const currentTime = Date.parse(current.updatedAt);
    const candidateTime = Date.parse(candidate.updatedAt);
    if (candidateTime > currentTime) {
      byId.set(candidate.id, clone(candidate));
    } else if (candidateTime === currentTime && canonicalJson(candidate) !== canonicalJson(current)) {
      fail(`conflicting annotation ${candidate.id} has the same updatedAt`);
    }
  }
  const tombstonesById = new Map(
    normalizedExisting.deletedAnnotations.map((item) => [item.id, clone(item)])
  );
  for (const candidate of normalizedIncoming.deletedAnnotations) {
    const current = tombstonesById.get(candidate.id);
    if (!current) {
      tombstonesById.set(candidate.id, clone(candidate));
      continue;
    }
    const currentTime = Date.parse(current.deletedAt);
    const candidateTime = Date.parse(candidate.deletedAt);
    if (candidateTime > currentTime) {
      tombstonesById.set(candidate.id, clone(candidate));
    } else if (
      candidateTime === currentTime
      && canonicalJson(candidate) !== canonicalJson(current)
    ) {
      fail(`conflicting deleted annotation ${candidate.id} has the same deletedAt`);
    }
  }
  for (const id of tombstonesById.keys()) byId.delete(id);
  const merged = {
    schemaVersion: 2,
    projectId: normalizedExisting.projectId,
    page: clone(normalizedExisting.page),
    annotations: [...byId.values()],
    deletedAnnotations: [...tombstonesById.values()],
    managedPrd: clone(normalizedExisting.managedPrd)
  };
  const beforeIds = new Set(
    normalizedExisting.annotations.map((annotation) => annotation.id)
  );
  const afterIds = new Set(merged.annotations.map((annotation) => annotation.id));
  const tombstoneIds = new Set(
    merged.deletedAnnotations.map(({ id }) => id)
  );
  for (const id of beforeIds) {
    if (!afterIds.has(id) && !tombstoneIds.has(id)) {
      fail(`${annotationPath}: merge would reduce the permanent annotation ID set without a tombstone`);
    }
  }
  return merged;
}

async function writeAnnotationTransaction(projectRoot, relativePath, document, expectedBeforeImage, transactionHooks) {
  const outputBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await applyProjectTransaction({
    projectRoot,
    operations: [makeProjectOperation(projectRoot, relativePath, outputBytes, { expectedBeforeImage })],
    transactionHooks: {
      beforeStageWrite: transactionHooks.beforeStageWrite
        ? ({ stagingPath, targetPath }) => transactionHooks.beforeStageWrite({ stagingPath, targetPath })
        : undefined,
      beforeCommit: transactionHooks.beforeRename
        ? ({ stagingPath, targetPath }) => transactionHooks.beforeRename({ stagingPath, targetPath })
        : undefined
    },
    verify: async () => {
      const { absolutePath } = await assertSafeProjectFile(projectRoot, relativePath, "annotation file");
      const installedBytes = await readFile(absolutePath);
      if (!installedBytes.equals(outputBytes)) fail(`Merged annotation verification failed: ${relativePath}`);
    }
  });
}

async function withPageMergeLock(projectRoot, page, action, { transactionHooks, lockOptions, onWarning }) {
  const target = await assertSafeProjectFile(projectRoot, page.annotationFile, "annotation file");
  const lockPath = `${target.absolutePath}.merge.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= lockOptions.timeoutMs) {
        fail(`Timed out waiting for annotation merge lock: ${lockPath}`);
      }
      await delay(lockOptions.retryMs);
    }
  }
  let result;
  let actionError;
  try {
    result = await action();
  } catch (error) {
    actionError = error;
  }

  let releaseError;
  let released = false;
  for (let attempt = 1; attempt <= lockOptions.releaseAttempts; attempt += 1) {
    try {
      await transactionHooks.beforeLockRelease?.({ attempt, lockPath });
      await rmdir(lockPath);
      released = true;
      break;
    } catch (error) {
      releaseError = error;
      if (attempt < lockOptions.releaseAttempts) await delay(lockOptions.releaseRetryMs);
    }
  }
  if (!released) {
    const warning = `Failed to release annotation merge lock after ${lockOptions.releaseAttempts} attempts: ${lockPath}: ${releaseError.message}`;
    try {
      onWarning?.(warning);
    } catch {
      // A warning observer cannot turn a committed write into a false failure.
    }
  }
  if (actionError) throw actionError;
  return result;
}

export async function mergeSnapshot({
  projectRoot,
  snapshot,
  transactionHooks = {},
  lockOptions = {},
  projectLock,
  projectLockOptions = {},
  onWarning
} = {}) {
  const validatedHooks = validateTransactionHooks(transactionHooks);
  const validatedLockOptions = validateLockOptions(lockOptions);
  if (onWarning !== undefined && typeof onWarning !== "function") fail("Invalid onWarning");
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const snapshotKind = identifySnapshot(snapshot);
  const manifest = await readProjectJson(normalizedRoot, MANIFEST_PATH, "manifest");
  validateManifestV2(manifest);
  validateSnapshotProjectIdentity(snapshot, snapshotKind, manifest);
  const rawPageId = snapshot.document.page?.id;
  const page = manifest.pages.find((entry) => entry.id === rawPageId);
  if (!page) fail("snapshot page.id is not authorized by manifest");
  validateSnapshotForPage({ snapshot, manifest, page });

  return withProjectMutationLock(normalizedRoot, async () => {
    const lockedManifest = await readProjectJson(normalizedRoot, MANIFEST_PATH, "manifest");
    validateManifestV2(lockedManifest);
    validateSnapshotProjectIdentity(snapshot, snapshotKind, lockedManifest);
    const lockedPage = lockedManifest.pages.find((entry) => entry.id === rawPageId);
    if (!lockedPage) fail("snapshot page.id is not authorized by manifest");
    const incoming = validateSnapshotForPage({ snapshot, manifest: lockedManifest, page: lockedPage });
    const documentIds = new Set(lockedManifest.documents.map((entry) => entry.id));

    return withPageMergeLock(normalizedRoot, lockedPage, async () => {
      const existingRead = await readProjectJsonWithBytes(normalizedRoot, lockedPage.annotationFile, "annotation file");
      const existing = existingRead.value;
      validateCompleteAnnotationDocument(existing, { documentIds });
      if (existing.projectId !== lockedManifest.project.id) fail("permanent document projectId does not match manifest");
      if (existing.page.id !== lockedPage.id) fail("permanent document page.id does not match manifest");
      if (existing.page.htmlPath !== lockedPage.htmlPath) fail("permanent document page.htmlPath does not match manifest");
      const merged = mergeAnnotations(existing, incoming, lockedPage.annotationFile);
      validateCompleteAnnotationDocument(merged, { documentIds });

      if (canonicalJson(merged) !== canonicalJson(existing)) {
        await writeAnnotationTransaction(
          normalizedRoot,
          lockedPage.annotationFile,
          merged,
          existingRead.bytes,
          validatedHooks
        );
      }
      return merged;
    }, {
      transactionHooks: validatedHooks,
      lockOptions: validatedLockOptions,
      onWarning
    });
  }, {
    lease: projectLock,
    lockOptions: projectLockOptions,
    onWarning
  });
}

async function readSnapshotFile(snapshotPath) {
  const absolutePath = path.resolve(String(snapshotPath || ""));
  const status = await lstat(absolutePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!status?.isFile() || status.isSymbolicLink()) fail("Invalid snapshot file");
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    fail(`Invalid snapshot JSON: ${error.message}`);
  }
}

export async function runMergeCli({ argv, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArguments(argv || []);
    const snapshot = await readSnapshotFile(options.snapshotPath);
    const incomingCount = Array.isArray(snapshot.document?.annotations) ? snapshot.document.annotations.length : 0;
    const incomingDeletionCount = Array.isArray(snapshot.document?.deletedAnnotations)
      ? snapshot.document.deletedAnnotations.length
      : 0;
    const merged = await mergeSnapshot({
      projectRoot: options.projectRoot,
      snapshot,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`)
    });
    stdout.write(
      `Merged ${merged.page.id}: ${incomingCount} incoming, ${incomingDeletionCount} deletions, ${merged.annotations.length} active, ${merged.deletedAnnotations.length} tombstones\n`
    );
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const invokedPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === invokedPath) {
  process.exitCode = await runMergeCli({ argv: process.argv.slice(2) });
}
