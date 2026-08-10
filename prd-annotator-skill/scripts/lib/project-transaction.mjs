import { createHash } from "node:crypto";
import { constants } from "node:fs";
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

function fileState(bytes) {
  return {
    type: "file",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function pathState(candidate) {
  const status = await pathStatus(candidate);
  if (!status) return { type: "missing" };
  if (status.isSymbolicLink()) return { type: "symlink" };
  if (status.isDirectory()) return { type: "directory" };
  if (!status.isFile()) return { type: "other" };
  return fileState(await readFile(candidate));
}

function sameState(left, right) {
  return left.type === right.type
    && (left.type !== "file" || (left.size === right.size && left.sha256 === right.sha256));
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
    || (transactionHooks.beforeRollbackCommit !== undefined
      && typeof transactionHooks.beforeRollbackCommit !== "function")
    || (transactionHooks.afterOriginalRead !== undefined
      && typeof transactionHooks.afterOriginalRead !== "function")
    || (transactionHooks.afterBeforeImagePrepared !== undefined
      && typeof transactionHooks.afterBeforeImagePrepared !== "function")
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
      const committedPath = path.join(stagingRoot, `committed-${index}`);
      const displacedPath = path.join(stagingRoot, `rollback-current-${index}`);
      await writeFile(stagePath, operation.data, { flag: "wx" });
      await copyFile(stagePath, committedPath);
      const originalBytes = status ? await readFile(operation.absolutePath) : null;
      await transactionHooks.afterOriginalRead?.({ relativePath: operation.relativePath, index });
      if (status) await writeFile(backupPath, originalBytes, { flag: "wx" });
      await transactionHooks.afterBeforeImagePrepared?.({ relativePath: operation.relativePath, index });
      prepared.push({
        ...operation,
        existed: Boolean(status),
        originalBytes,
        originalState: originalBytes ? fileState(originalBytes) : { type: "missing" },
        committedState: fileState(await readFile(committedPath)),
        stagePath,
        backupPath,
        committedPath,
        displacedPath
      });
    }
    try {
      for (let index = 0; index < prepared.length; index += 1) {
        const operation = prepared[index];
        await ensureParentDirectories(normalizedRoot, path.dirname(operation.absolutePath), createdDirectories);
        const currentState = await pathState(operation.absolutePath);
        if (!sameState(currentState, operation.originalState)) {
          throw new Error(`Concurrent modification detected: ${operation.relativePath}`);
        }
        await rename(operation.stagePath, operation.absolutePath);
        committed.push(operation);
        await transactionHooks.afterCommit?.({ relativePath: operation.relativePath, index });
      }
      await verify();
    } catch (error) {
      const rollbackProblems = [];
      const rollbackRecords = new Map();
      for (const operation of [...committed].reverse()) {
        let rollback = "failed";
        let problem = null;
        let displacedState = { type: "missing" };
        try {
          await transactionHooks.beforeRollbackOperation?.({
            relativePath: operation.relativePath,
            existed: operation.existed
          });
          const observedState = await pathState(operation.absolutePath);
          if (!sameState(observedState, operation.committedState)) {
            rollback = "preserved-current";
            throw new Error(`Concurrent modification detected during rollback: ${operation.relativePath}`);
          }
          await transactionHooks.beforeRollbackCommit?.({
            relativePath: operation.relativePath,
            existed: operation.existed
          });
          await rename(operation.absolutePath, operation.displacedPath);
          displacedState = await pathState(operation.displacedPath);
          if (!sameState(displacedState, operation.committedState)) {
            rollback = "preserved-current";
            if (displacedState.type === "file") {
              try {
                await copyFile(operation.displacedPath, operation.absolutePath, constants.COPYFILE_EXCL);
              } catch (restoreError) {
                if (restoreError?.code !== "EEXIST") throw restoreError;
              }
            }
            throw new Error(`Concurrent modification detected during rollback commit: ${operation.relativePath}`);
          }
          if (operation.existed) {
            try {
              await copyFile(operation.backupPath, operation.absolutePath, constants.COPYFILE_EXCL);
            } catch (restoreError) {
              if (restoreError?.code === "EEXIST") {
                rollback = "preserved-current";
                throw new Error(`Concurrent modification detected during rollback restore: ${operation.relativePath}`);
              }
              throw restoreError;
            }
            rollback = "restored-original";
          } else {
            rollback = "removed-committed";
          }
        } catch (rollbackError) {
          problem = rollbackError;
          rollbackProblems.push(rollbackError);
        }
        let currentState;
        try {
          currentState = await pathState(operation.absolutePath);
        } catch (stateError) {
          currentState = { type: "unreadable", error: stateError.message };
          if (!problem) rollbackProblems.push(stateError);
        }
        rollbackRecords.set(operation.relativePath, { rollback, currentState, displacedState });
      }
      try {
        await removeCreatedDirectories(createdDirectories);
      } catch (directoryError) {
        rollbackProblems.push(directoryError);
      }
      if (committed.length) {
        retainRecovery = true;
        const recoveryPath = path.join(stagingRoot, "recovery.json");
        const rollbackError = [...new Set(rollbackProblems.map((problem) => problem.message))].join("; ") || null;
        const recovery = {
          schemaVersion: 2,
          error: error.message,
          rollbackError,
          targets: committed.map((operation) => {
            const record = rollbackRecords.get(operation.relativePath);
            return {
              relativePath: operation.relativePath,
              rollback: record.rollback,
              original: operation.originalState,
              committed: operation.committedState,
              current: record.currentState,
              displaced: record.displacedState,
              survivingPaths: {
                target: record.currentState.type === "missing" ? null : operation.absolutePath,
                original: operation.existed ? operation.backupPath : null,
                committed: operation.committedPath,
                displaced: record.displacedState.type === "missing" ? null : operation.displacedPath
              }
            };
          })
        };
        try {
          await writeFile(recoveryPath, `${JSON.stringify(recovery, null, 2)}\n`, { flag: "wx" });
        } catch (recoveryError) {
          const rollbackStatus = rollbackError ? `rollback failed: ${rollbackError}` : "rollback completed";
          throw new Error(`${error.message}; ${rollbackStatus}; recovery staging retained at ${stagingRoot}; recovery metadata failed: ${recoveryError.message}`);
        }
        if (rollbackError) {
          throw new Error(`${error.message}; rollback failed: ${rollbackError}; recovery retained at ${stagingRoot}`);
        }
        throw new Error(`${error.message}; rollback completed; recovery retained at ${stagingRoot}`);
      }
      throw error;
    }
  } finally {
    if (!retainRecovery) await rm(stagingRoot, { recursive: true, force: true });
  }
}
