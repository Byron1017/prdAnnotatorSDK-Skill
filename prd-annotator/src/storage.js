import { LEGACY_STORAGE_PREFIX, STORAGE_PREFIX } from "./constants.js";
import {
  resolveLegacyPageId,
  resolveLegacyProjectKey
} from "./identity.js";

export function makeStorageKey(projectId, pageId) {
  return `${STORAGE_PREFIX}:${projectId}:${pageId}`;
}

export function makeLegacyStorageKeys({
  projectId,
  pageId,
  scriptSrc,
  pathname,
  hasExplicitProjectId = false
}) {
  const legacyProjectId = resolveLegacyProjectKey({ scriptSrc });
  const legacyPageId = resolveLegacyPageId({ pathname });
  const keys = [
    `${LEGACY_STORAGE_PREFIX}:${projectId}:${pageId}`,
    `${LEGACY_STORAGE_PREFIX}:${projectId}:${legacyPageId}`
  ];
  if (!hasExplicitProjectId) {
    keys.push(
      `${LEGACY_STORAGE_PREFIX}:${legacyProjectId}:${pageId}`,
      `${LEGACY_STORAGE_PREFIX}:${legacyProjectId}:${legacyPageId}`
    );
  }
  return [...new Set(keys)];
}

export function createCacheStore({ storage, key, fallbackKeys = [] }) {
  let memoryRecord = null;
  let status = { mode: "storage", errorName: null };

  return Object.freeze({
    load() {
      for (const candidateKey of [key, ...fallbackKeys]) {
        try {
          const raw = storage?.getItem(candidateKey);
          if (raw) return JSON.parse(raw);
        } catch (error) {
          status = { mode: "memory", errorName: error?.name || "StorageError" };
        }
      }
      return memoryRecord ? structuredClone(memoryRecord) : null;
    },
    save(record) {
      memoryRecord = structuredClone(record);
      try {
        storage?.setItem(key, JSON.stringify(record));
        status = { mode: "storage", errorName: null };
        return { persisted: true, errorName: null };
      } catch (error) {
        status = { mode: "memory", errorName: error?.name || "StorageError" };
        return { persisted: false, errorName: status.errorName };
      }
    },
    getStatus: () => ({ ...status })
  });
}
