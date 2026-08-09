import { describe, expect, it } from "vitest";
import {
  assertValidDocument,
  createEmptyDocument
} from "../../prd-annotator/src/model.js";

describe("annotation document", () => {
  it("creates a valid empty page document", () => {
    const document = createEmptyDocument({
      id: "equipment-ops",
      title: "Equipment Operations",
      route: "/equipment/ops"
    });

    expect(assertValidDocument(document)).toBe(document);
    expect(document).toEqual({
      schemaVersion: 1,
      page: {
        id: "equipment-ops",
        title: "Equipment Operations",
        route: "/equipment/ops"
      },
      annotations: []
    });
  });

  it("rejects invalid page ids", () => {
    const document = createEmptyDocument({ id: "设备运维", route: "/设备/运维" });
    expect(() => assertValidDocument(document)).toThrow("Invalid page.id");
  });
});
