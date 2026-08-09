import { describe, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  mergeAnnotationDocuments
} from "../../prd-annotator/src/model.js";
import {
  createCacheStore,
  makeStorageKey
} from "../../prd-annotator/src/storage.js";

const page = {
  id: "equipment-ops",
  title: "Equipment Operations",
  route: "/equipment/ops"
};

const annotation = (id, updatedAt, comment = id) => ({
  id,
  comment,
  status: "open",
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt,
  target: {
    cssPath: "main",
    xpath: "/html/body/main",
    textQuote: "Main",
    rect: { x: 0, y: 0, width: 10, height: 10 }
  },
  prd: { linkedSections: [], impactScope: "page", summary: "" }
});

const v1CacheRecord = {
  schemaVersion: 1,
  document: {
    ...createEmptyDocument(page),
    schemaVersion: 1,
    annotations: [annotation("A001", "2026-08-08T00:00:00.000Z")]
  },
  pagePrdMarkdown: "# Legacy PRD"
};

const v2CacheRecord = {
  schemaVersion: 2,
  document: createEmptyDocument(page),
  pagePrdMarkdown: "# Current PRD"
};

describe("non-destructive data", () => {
  it("does not drop base annotations when incoming is empty", () => {
    const base = {
      ...createEmptyDocument(page),
      annotations: [annotation("A001", "2026-08-08T01:00:00.000Z")]
    };

    expect(mergeAnnotationDocuments(base, createEmptyDocument(page)).annotations)
      .toHaveLength(1);
  });

  it("adds new ids and uses the newest version of an existing id", () => {
    const base = {
      ...createEmptyDocument(page),
      annotations: [annotation("A001", "2026-08-08T01:00:00.000Z", "old")]
    };
    const incoming = {
      ...createEmptyDocument(page),
      annotations: [
        annotation("A001", "2026-08-08T02:00:00.000Z", "new"),
        annotation("A002", "2026-08-08T02:00:00.000Z")
      ]
    };

    const merged = mergeAnnotationDocuments(base, incoming);
    expect(merged.annotations.map((item) => item.id)).toEqual(["A001", "A002"]);
    expect(merged.annotations[0].comment).toBe("new");
  });

  it("rejects merges across different pages", () => {
    const other = createEmptyDocument({
      id: "maintenance-records",
      title: "Maintenance Records",
      route: "/maintenance/records"
    });

    expect(() => mergeAnnotationDocuments(createEmptyDocument(page), other))
      .toThrow("Cannot merge different pages");
  });

  it("returns null for malformed cache without changing storage", () => {
    const storage = {
      getItem: vi.fn(() => "{"),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };
    const cache = createCacheStore({ storage, key: "test" });

    expect(cache.load()).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(cache.remove).toBeUndefined();
  });

  it("writes cache without exposing a clear operation", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const cache = createCacheStore({ storage, key: "test" });
    cache.save({
      schemaVersion: 1,
      document: createEmptyDocument(page),
      pagePrdMarkdown: "# PRD"
    });

    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(cache.clear).toBeUndefined();
  });

  it("keeps an in-memory copy when browser storage rejects writes", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      })
    };
    const cache = createCacheStore({ storage, key: "test" });
    const record = {
      schemaVersion: 1,
      document: createEmptyDocument(page),
      pagePrdMarkdown: "# PRD"
    };

    cache.save(record);
    expect(cache.load()).toEqual(record);
  });

  it("reports memory-only mode after localStorage rejects a write", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new DOMException("blocked", "SecurityError"); })
    };
    const cache = createCacheStore({ storage, key: "v2", fallbackKeys: ["v1"] });
    expect(cache.save({ schemaVersion: 2 })).toEqual({
      persisted: false,
      errorName: "SecurityError"
    });
    expect(cache.getStatus()).toEqual({ mode: "memory", errorName: "SecurityError" });
  });

  it("loads a v1 cache through fallback keys and writes only the v2 key", () => {
    const v1Key = "prd-annotator:v1:device-demo:equipment-ops";
    const v2Key = "prd-annotator:v2:device-demo:equipment-ops";
    const storage = {
      getItem: vi.fn((key) => key === v1Key ? JSON.stringify(v1CacheRecord) : null),
      setItem: vi.fn()
    };
    const cache = createCacheStore({ storage, key: v2Key, fallbackKeys: [v1Key] });
    expect(cache.load()).toEqual(v1CacheRecord);
    cache.save(v2CacheRecord);
    expect(storage.setItem).toHaveBeenCalledWith(v2Key, JSON.stringify(v2CacheRecord));
    expect(storage.setItem).not.toHaveBeenCalledWith(v1Key, expect.any(String));
  });

  it("creates a page-isolated key", () => {
    expect(makeStorageKey("project-a", "equipment-ops"))
      .toBe("prd-annotator:v2:project-a:equipment-ops");
  });
});
