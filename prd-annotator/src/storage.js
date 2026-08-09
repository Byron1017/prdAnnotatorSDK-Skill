import { STORAGE_PREFIX } from "./constants.js";

export function makeStorageKey(projectKey, pageId) {
  return `${STORAGE_PREFIX}:${projectKey}:${pageId}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createCacheStore({ storage, key }) {
  let memoryRecord = null;

  return Object.freeze({
    load() {
      try {
        const raw = storage?.getItem(key);
        if (!raw) return memoryRecord ? clone(memoryRecord) : null;
        return JSON.parse(raw);
      } catch {
        return memoryRecord ? clone(memoryRecord) : null;
      }
    },
    save(record) {
      memoryRecord = clone(record);
      try {
        storage?.setItem(key, JSON.stringify(record));
      } catch {
        // The in-memory record remains available for the current browser session.
      }
      return record;
    }
  });
}
