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

  it("creates a page-isolated key", () => {
    expect(makeStorageKey("project-a", "equipment-ops"))
      .toBe("prd-annotator:v1:project-a:equipment-ops");
  });
});
