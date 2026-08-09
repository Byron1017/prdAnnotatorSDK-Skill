import { copyFile, lstat, mkdir, readFile, realpath, rename, rmdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertInsideProject, toProjectPath } from "./project.mjs";

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function assertProjectRelativePath(value, label) {
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

export async function assertSafeProjectWritePath(projectRoot, relativePath, label, { targetType = "file" } = {}) {
  assertProjectRelativePath(relativePath, label);
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const absolutePath = path.resolve(normalizedRoot, ...relativePath.split("/"));
  assertInsideProject(normalizedRoot, absolutePath, label);
  const rootStatus = await pathStatus(normalizedRoot);
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new Error(`Unsafe ${label} ancestor: project root`);
  }
  const resolvedRoot = await realpath(normalizedRoot);
  let current = normalizedRoot;
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const status = await pathStatus(current);
    const partialPath = segments.slice(0, index + 1).join("/");
    const isTarget = index === segments.length - 1;
    if (!status) break;
    if (status.isSymbolicLink()) {
      throw new Error(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${partialPath}`);
    }
    if (!isTarget && !status.isDirectory()) throw new Error(`Unsafe ${label} ancestor: ${partialPath}`);
    if (isTarget && targetType === "file" && !status.isFile()) throw new Error(`Unsafe ${label} target: ${partialPath}`);
    if (isTarget && targetType === "directory" && !status.isDirectory()) throw new Error(`Unsafe ${label} target: ${partialPath}`);
    const resolvedCurrent = await realpath(current);
    try {
      assertInsideProject(resolvedRoot, resolvedCurrent, label);
    } catch {
      throw new Error(`Unsafe ${label} ${isTarget ? "target" : "ancestor"}: ${partialPath}`);
    }
  }
  return { absolutePath };
}

export function normalizeNow(now) {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("now must produce a valid date");
  return date.toISOString();
}

export function makeProjectOperation(projectRoot, relativePath, data) {
  assertProjectRelativePath(relativePath, "transaction output path");
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const absolutePath = path.resolve(normalizedRoot, ...relativePath.split("/"));
  assertInsideProject(normalizedRoot, absolutePath, relativePath);
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
        throw new Error(`Unsafe transaction directory: ${toProjectPath(projectRoot, current)}`);
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

export async function applyProjectTransaction({ projectRoot, operations, verify, transactionHooks = {} } = {}) {
  if (!Array.isArray(operations) || operations.length === 0) throw new Error("Transaction operations are required");
  if (typeof verify !== "function") throw new Error("Transaction verification is required");
  if (
    !transactionHooks
    || typeof transactionHooks !== "object"
    || (transactionHooks.afterCommit !== undefined && typeof transactionHooks.afterCommit !== "function")
    || (transactionHooks.beforeRollbackOperation !== undefined
      && typeof transactionHooks.beforeRollbackOperation !== "function")
  ) {
    throw new Error("Invalid transactionHooks");
  }
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  const paths = new Set();
  for (const operation of operations) {
    if (!operation || typeof operation.relativePath !== "string" || paths.has(operation.relativePath)) {
      throw new Error(`Duplicate or invalid transaction path: ${operation?.relativePath || "<missing>"}`);
    }
    paths.add(operation.relativePath);
  }
  const stagingRoot = path.join(
    normalizedRoot,
    `.prd-annotator-transaction-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const prepared = [];
  const committed = [];
  const createdDirectories = new Set();
  let retainRecovery = false;
  try {
    for (const operation of operations) {
      await assertSafeProjectWritePath(normalizedRoot, operation.relativePath, "transaction output");
    }
    await mkdir(stagingRoot, { recursive: false });
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const status = await pathStatus(operation.absolutePath);
      const stagePath = path.join(stagingRoot, `new-${index}`);
      const backupPath = path.join(stagingRoot, `backup-${index}`);
      await writeFile(stagePath, operation.data, { flag: "wx" });
      const originalBytes = status ? await readFile(operation.absolutePath) : null;
      if (status) await copyFile(operation.absolutePath, backupPath);
      prepared.push({ ...operation, existed: Boolean(status), originalBytes, stagePath, backupPath });
    }
    try {
      for (let index = 0; index < prepared.length; index += 1) {
        const operation = prepared[index];
        await ensureParentDirectories(normalizedRoot, path.dirname(operation.absolutePath), createdDirectories);
        const currentStatus = await pathStatus(operation.absolutePath);
        const existenceChanged = Boolean(currentStatus) !== operation.existed;
        const bytesChanged = currentStatus && operation.existed
          ? !Buffer.from(await readFile(operation.absolutePath)).equals(operation.originalBytes)
          : false;
        if (existenceChanged || bytesChanged) {
          throw new Error(`Concurrent modification detected: ${operation.relativePath}`);
        }
        await rename(operation.stagePath, operation.absolutePath);
        committed.push(operation);
        await transactionHooks.afterCommit?.({ relativePath: operation.relativePath, index });
      }
      await verify();
    } catch (error) {
      try {
        for (const operation of [...committed].reverse()) {
          await transactionHooks.beforeRollbackOperation?.({
            relativePath: operation.relativePath,
            existed: operation.existed
          });
          if (operation.existed) await copyFile(operation.backupPath, operation.absolutePath);
          else await rm(operation.absolutePath, { force: true });
        }
        await removeCreatedDirectories(createdDirectories);
      } catch (rollbackError) {
        retainRecovery = true;
        const recoveryPath = path.join(stagingRoot, "recovery.json");
        const recovery = {
          schemaVersion: 1,
          error: error.message,
          rollbackError: rollbackError.message,
          targets: committed.map((operation) => ({
            relativePath: operation.relativePath,
            existed: operation.existed,
            backup: operation.existed ? path.basename(operation.backupPath) : null
          }))
        };
        try {
          await writeFile(recoveryPath, `${JSON.stringify(recovery, null, 2)}\n`, { flag: "wx" });
        } catch (recoveryError) {
          throw new Error(`${error.message}; rollback failed: ${rollbackError.message}; recovery staging retained at ${stagingRoot}; recovery metadata failed: ${recoveryError.message}`);
        }
        throw new Error(`${error.message}; rollback failed: ${rollbackError.message}; recovery retained at ${stagingRoot}`);
      }
      throw error;
    }
  } finally {
    if (!retainRecovery) await rm(stagingRoot, { recursive: true, force: true });
  }
}
