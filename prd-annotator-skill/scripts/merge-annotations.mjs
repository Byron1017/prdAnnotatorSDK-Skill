import { lstat, mkdir, readFile, rename, rmdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectRelativePath,
  assertSafeProjectFile,
  validateCompleteAnnotationDocument
} from "./check-project.mjs";
import {
  canonicalJson,
  fingerprintValue,
  normalizeAnnotationDocument,
  validateManifestV2
} from "./lib/schema.mjs";

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

function validateSnapshotProjectIdentity(snapshot, kind, manifest) {
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
  if (envelopeProjectId !== manifest.project.id) fail("snapshot projectId does not match manifest");
  return envelopeProjectId;
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
    if (snapshot.fingerprint !== fingerprintValue(incoming.annotations)) {
      fail("payload fingerprint does not match annotations");
    }
  }
  if (
    kind.rawSnapshot
    && snapshot.annotationFingerprint !== undefined
    && snapshot.annotationFingerprint !== fingerprintValue(incoming.annotations)
  ) {
    fail("snapshot annotationFingerprint does not match annotations");
  }
}

function mergeAnnotations(existing, incoming, annotationPath) {
  const byId = new Map(existing.annotations.map((annotation) => [annotation.id, clone(annotation)]));
  for (const candidate of incoming.annotations) {
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
  const merged = {
    schemaVersion: 2,
    projectId: existing.projectId,
    page: clone(existing.page),
    annotations: [...byId.values()],
    managedPrd: clone(existing.managedPrd)
  };
  const beforeIds = new Set(existing.annotations.map((annotation) => annotation.id));
  const afterIds = new Set(merged.annotations.map((annotation) => annotation.id));
  for (const id of beforeIds) {
    if (!afterIds.has(id)) fail(`${annotationPath}: merge would reduce the permanent annotation ID set`);
  }
  if (afterIds.size < beforeIds.size) fail(`${annotationPath}: merge would reduce the permanent annotation ID set`);
  return merged;
}

async function atomicWriteAnnotation(projectRoot, relativePath, document, transactionHooks) {
  const target = await assertSafeProjectFile(projectRoot, relativePath, "annotation file");
  const directory = path.posix.dirname(relativePath);
  const fileName = path.posix.basename(relativePath);
  const temporaryRelativePath = `${directory}/.${fileName}.merge-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  assertProjectRelativePath(temporaryRelativePath, "annotation staging path");
  const staging = await assertSafeProjectFile(
    projectRoot,
    temporaryRelativePath,
    "annotation staging file",
    { allowMissing: true }
  );
  try {
    await transactionHooks.beforeStageWrite?.({
      stagingPath: staging.absolutePath,
      targetPath: target.absolutePath
    });
    await writeFile(staging.absolutePath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await transactionHooks.beforeRename?.({
      stagingPath: staging.absolutePath,
      targetPath: target.absolutePath
    });
    await rename(staging.absolutePath, target.absolutePath);
  } catch (error) {
    await rm(staging.absolutePath, { force: true });
    throw error;
  }
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
  const incoming = normalizeIncomingDocument(snapshot, manifest, page);
  validateSnapshotEnvelope(snapshot, snapshotKind, manifest, page, incoming);
  const documentIds = new Set(manifest.documents.map((entry) => entry.id));
  validateCompleteAnnotationDocument(incoming, { documentIds });

  return withPageMergeLock(normalizedRoot, page, async () => {
    const existing = await readProjectJson(normalizedRoot, page.annotationFile, "annotation file");
    validateCompleteAnnotationDocument(existing, { documentIds });
    if (existing.projectId !== manifest.project.id) fail("permanent document projectId does not match manifest");
    if (existing.page.id !== page.id) fail("permanent document page.id does not match manifest");
    if (existing.page.htmlPath !== page.htmlPath) fail("permanent document page.htmlPath does not match manifest");
    const merged = mergeAnnotations(existing, incoming, page.annotationFile);
    validateCompleteAnnotationDocument(merged, { documentIds });

    if (canonicalJson(merged) !== canonicalJson(existing)) {
      await atomicWriteAnnotation(normalizedRoot, page.annotationFile, merged, validatedHooks);
    }
    return merged;
  }, {
    transactionHooks: validatedHooks,
    lockOptions: validatedLockOptions,
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
    const merged = await mergeSnapshot({
      projectRoot: options.projectRoot,
      snapshot,
      onWarning: (warning) => stderr.write(`Warning: ${warning}\n`)
    });
    stdout.write(
      `Merged ${merged.page.id}: ${incomingCount} incoming, ${merged.annotations.length} total\n`
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
