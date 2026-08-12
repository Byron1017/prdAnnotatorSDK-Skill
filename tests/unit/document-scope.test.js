import { describe, expect, it } from "vitest";
import {
  assertDocumentScope,
  hubCategoryForDocument,
  isCurrentPageDocument,
  scopeOfDocument
} from "../../prd-annotator/src/document-scope.js";

describe("browser document scope", () => {
  it("accepts explicit valid page, global, and unassigned entries", () => {
    const pageEntry = { kind: "field-spec", scope: "page", pageIds: ["page-a"] };
    expect(assertDocumentScope(pageEntry)).toBe(pageEntry);
    expect(scopeOfDocument(pageEntry)).toBe("page");
    expect(isCurrentPageDocument(pageEntry, "page-a")).toBe(true);
    expect(isCurrentPageDocument(pageEntry, "page-b")).toBe(false);
    expect(() => assertDocumentScope({ kind: "field-spec", scope: "global", pageIds: [] })).not.toThrow();
    expect(() => assertDocumentScope({ kind: "api-doc", scope: "unassigned", pageIds: [] })).not.toThrow();
  });

  it.each([
    [{ kind: "field-spec", pageIds: [] }, "explicit scope"],
    [{ kind: "field-spec", scope: "page", pageIds: [] }, "page scope requires pageIds"],
    [{ kind: "api-doc", scope: "global", pageIds: ["page-a"] }, "global scope requires empty pageIds"],
    [{ kind: "page-prd", scope: "global", pageIds: [] }, "page-prd cannot be global"],
    [{ kind: "total-prd", scope: "unassigned", pageIds: [] }, "total-prd must be global"],
    [{ kind: "unclassified", scope: "global", pageIds: [] }, "unclassified must be unassigned"],
    [{ kind: "field-spec", scope: "project", pageIds: [] }, "invalid document scope"]
  ])("rejects invalid View scope %j", (entry, message) => {
    expect(() => assertDocumentScope(entry)).toThrow(message);
  });

  it.each([
    ["total-prd", "prd"],
    ["page-prd", "prd"],
    ["field-spec", "field"],
    ["api-doc", "api"],
    ["requirement", "requirement"],
    ["other", "requirement"]
  ])("maps %s to the %s hub category", (kind, category) => {
    expect(hubCategoryForDocument({ kind })).toBe(category);
  });
});
