import { describe, expect, it } from "vitest";
import {
  annotationDisplayNumber,
  annotationFingerprintInput,
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
      deletedAnnotations: [],
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
      prdContent: v1Document.annotations[0].comment,
      acceptanceCriteria: "",
      dataFields: "",
      apiPath: "",
      edgeCases: ""
    });
  });

  it("normalizes legacy documents with an empty deletion tombstone array", () => {
    const normalized = normalizeAnnotationDocument({
      ...createEmptyDocument({ id: "equipment-ops", route: "/equipment/ops" }),
      deletedAnnotations: undefined
    });

    expect(normalized.deletedAnnotations).toEqual([]);
  });

  it("keeps legacy fingerprints stable until a tombstone exists", () => {
    const document = {
      ...createEmptyDocument({ id: "equipment-ops", route: "/equipment/ops" }),
      annotations: [{ ...v1Document.annotations[0] }]
    };

    expect(annotationFingerprintInput(document)).toEqual(document.annotations);
    document.deletedAnnotations = [
      { id: "A002", deletedAt: "2026-08-11T09:00:00.000Z" }
    ];
    expect(annotationFingerprintInput(document)).toEqual({
      annotations: document.annotations,
      deletedAnnotations: document.deletedAnnotations
    });
  });

  it("derives stable display numbers from SDK ids", () => {
    expect(annotationDisplayNumber({ id: "A003" }, 0)).toBe("3");
    expect(annotationDisplayNumber({ id: "legacy-note" }, 4)).toBe("5");
  });

  it.each([
    [
      (document) => { document.deletedAnnotations = "A001"; },
      "deletedAnnotations must be an array"
    ],
    [
      (document) => {
        document.deletedAnnotations = [
          { id: "", deletedAt: "2026-08-11T09:00:00.000Z" }
        ];
      },
      "Invalid deleted annotation id"
    ],
    [
      (document) => {
        document.deletedAnnotations = [{ id: "A002", deletedAt: "yesterday" }];
      },
      "Invalid deleted annotation A002.deletedAt"
    ],
    [
      (document) => {
        document.deletedAnnotations = [
          { id: "A002", deletedAt: "2026-08-11T09:00:00.000Z" },
          { id: "A002", deletedAt: "2026-08-11T09:01:00.000Z" }
        ];
      },
      "Duplicate deleted annotation A002"
    ],
    [
      (document) => {
        document.annotations = [normalizeAnnotationDocument(v1Document).annotations[0]];
        document.deletedAnnotations = [
          { id: "A001", deletedAt: "2026-08-11T09:00:00.000Z" }
        ];
      },
      "Annotation A001 cannot be active and deleted"
    ]
  ])("rejects invalid deletion tombstones", (mutate, expected) => {
    const document = createEmptyDocument({
      id: "equipment-ops",
      route: "/equipment/ops"
    });
    mutate(document);

    expect(() => assertValidDocument(document)).toThrow(expected);
  });
});
