import { describe, expect, it } from "vitest";
import {
  documentBelongsToPage,
  inferDocumentScope,
  normalizeDocumentScope,
  validateDocumentScope
} from "../../prd-annotator-skill/scripts/lib/document-scope.mjs";

describe("Agent document scope", () => {
  it.each([
    [{ kind: "field-spec", pageIds: ["message-a13f92"] }, "page"],
    [{ kind: "api-doc", pageIds: ["message-a13f92"] }, "page"],
    [{ kind: "total-prd", pageIds: [] }, "global"],
    [{ kind: "public-rule", pageIds: [] }, "global"],
    [{ kind: "field-spec", pageIds: [] }, "unassigned"],
    [{ kind: "api-doc", pageIds: [] }, "unassigned"],
    [{ kind: "page-prd", pageIds: [] }, "unassigned"],
    [{ kind: "unclassified", pageIds: [] }, "unassigned"]
  ])("infers historical %j as %s", (entry, expected) => {
    expect(inferDocumentScope(entry)).toBe(expected);
    expect(normalizeDocumentScope(entry)).toEqual({ ...entry, scope: expected });
  });

  it.each([
    [{ kind: "field-spec", scope: "page", pageIds: [] }, "page scope requires pageIds"],
    [{ kind: "api-doc", scope: "global", pageIds: ["message-a13f92"] }, "global scope requires empty pageIds"],
    [{ kind: "page-prd", scope: "global", pageIds: [] }, "page-prd cannot be global"],
    [{ kind: "total-prd", scope: "unassigned", pageIds: [] }, "total-prd must be global"],
    [{ kind: "unclassified", scope: "global", pageIds: [] }, "unclassified must be unassigned"],
    [{ kind: "field-spec", scope: "project", pageIds: [] }, "invalid document scope"]
  ])("rejects %j", (entry, message) => {
    expect(() => validateDocumentScope(entry, new Set(["message-a13f92"])))
      .toThrow(message);
  });

  it("rejects page mappings outside the manifest", () => {
    expect(() => validateDocumentScope(
      { kind: "field-spec", scope: "page", pageIds: ["other-page"] },
      new Set(["message-a13f92"])
    )).toThrow("unknown pageId: other-page");
  });

  it("matches only explicit current-page scope", () => {
    const entry = { kind: "field-spec", scope: "page", pageIds: ["page-a"] };
    expect(documentBelongsToPage(entry, "page-a")).toBe(true);
    expect(documentBelongsToPage(entry, "page-b")).toBe(false);
  });
});
