import { describe, expect, it } from "vitest";
import {
  assertValidDocument,
  createEmptyDocument,
  normalizeAnnotationDocument
} from "../../prd-annotator/src/model.js";

const v1Document = {
  schemaVersion: 1,
  page: {
    id: "equipment-ops",
    title: "Equipment Operations",
    route: "/prototype/index.html"
  },
  annotations: [{
    id: "A001",
    comment: "Batch disable",
    status: "open",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Equipment list",
      rect: { x: 0, y: 0, width: 100, height: 40 }
    },
    prd: { linkedSections: [], impactScope: "page", summary: "" }
  }]
};

describe("annotation document", () => {
  it("creates a valid empty page document", () => {
    const document = createEmptyDocument({
      id: "equipment-ops",
      title: "Equipment Operations",
      route: "/equipment/ops"
    });

    expect(assertValidDocument(document)).toBe(document);
    expect(document).toEqual({
      schemaVersion: 2,
      projectId: undefined,
      page: {
        id: "equipment-ops",
        title: "Equipment Operations",
        htmlPath: "/",
        route: "/equipment/ops"
      },
      annotations: [],
      managedPrd: null
    });
  });

  it("rejects invalid page ids", () => {
    const document = createEmptyDocument({ id: "设备运维", route: "/设备/运维" });
    expect(() => assertValidDocument(document)).toThrow("Invalid page.id");
  });

  it("normalizes a v1 annotation into required v2 fields without losing its id", () => {
    const migrated = normalizeAnnotationDocument(v1Document, {
      projectId: "device-demo-a13f92",
      htmlPath: "prototype/index.html"
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.annotations[0]).toMatchObject({
      id: "A001",
      title: v1Document.annotations[0].comment,
      description: v1Document.annotations[0].comment,
      type: "requirement",
      prdContent: v1Document.annotations[0].comment
    });
  });
});
