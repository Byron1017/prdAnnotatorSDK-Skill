import { lstat, mkdir, rmdir } from "node:fs/promises";
import path from "node:path";

const LOCK_DIRECTORY = ".prd-annotator-project-write.lock";
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 10;
const LOCK_RELEASE_ATTEMPTS = 3;
const activeLeases = new WeakSet();

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateOptions(lockOptions) {
  if (!isRecord(lockOptions)) fail("Invalid projectLockOptions");
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
    fail("Invalid projectLockOptions");
  }
  return result;
}

function observeWarning(onWarning, message) {
  try {
    onWarning?.(message);
  } catch {
    // Warning observers cannot turn a completed project mutation into a false failure.
  }
}

export async function withProjectMutationLock(
  projectRoot,
  action,
  { lease, lockOptions = {}, onWarning } = {}
) {
  if (typeof action !== "function") fail("Project mutation action is required");
  if (onWarning !== undefined && typeof onWarning !== "function") fail("Invalid onWarning");
  const normalizedRoot = path.resolve(String(projectRoot || ""));
  if (lease !== undefined) {
    if (!activeLeases.has(lease) || lease.projectRoot !== normalizedRoot) {
      fail("Invalid project mutation lock lease");
    }
    return action(lease);
  }
  const options = validateOptions(lockOptions);
  const rootStatus = await lstat(normalizedRoot).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) {
    fail("projectRoot must be a non-symlink directory");
  }
  const lockPath = path.join(normalizedRoot, LOCK_DIRECTORY);
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - startedAt >= options.timeoutMs) {
        fail(`Timed out waiting for project mutation lock: ${lockPath}`);
      }
      await delay(options.retryMs);
    }
  }

  const acquiredLease = Object.freeze({ projectRoot: normalizedRoot, lockPath });
  activeLeases.add(acquiredLease);
  let result;
  let actionError;
  try {
    result = await action(acquiredLease);
  } catch (error) {
    actionError = error;
  }

  activeLeases.delete(acquiredLease);
  let releaseError;
  let released = false;
  for (let attempt = 1; attempt <= options.releaseAttempts; attempt += 1) {
    try {
      await rmdir(lockPath);
      released = true;
      break;
    } catch (error) {
      releaseError = error;
      if (attempt < options.releaseAttempts) await delay(options.releaseRetryMs);
    }
  }
  if (!released) {
    observeWarning(
      onWarning,
      `Failed to release project mutation lock after ${options.releaseAttempts} attempts: ${lockPath}: ${releaseError.message}`
    );
  }
  if (actionError) throw actionError;
  return result;
}
