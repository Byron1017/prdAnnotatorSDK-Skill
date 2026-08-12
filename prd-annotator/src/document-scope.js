export const DOCUMENT_SCOPES = new Set(["page", "global", "unassigned"]);

const GLOBAL_ONLY_KINDS = new Set(["total-prd", "public", "public-rule"]);

export function scopeOfDocument(entry) {
  return entry?.scope;
}

export function assertDocumentScope(entry) {
  if (!entry || entry.scope === undefined) throw new Error("View document requires explicit scope");
  if (!DOCUMENT_SCOPES.has(entry.scope)) throw new Error("invalid document scope");
  const pageIds = Array.isArray(entry.pageIds) ? entry.pageIds : [];
  if (entry.scope === "page" && !pageIds.length) throw new Error("page scope requires pageIds");
  if (entry.scope !== "page" && pageIds.length) throw new Error(`${entry.scope} scope requires empty pageIds`);
  if (entry.kind === "page-prd" && entry.scope === "global") throw new Error("page-prd cannot be global");
  if (GLOBAL_ONLY_KINDS.has(entry.kind) && entry.scope !== "global") {
    throw new Error(`${entry.kind} must be global`);
  }
  if (entry.kind === "unclassified" && entry.scope !== "unassigned") {
    throw new Error("unclassified must be unassigned");
  }
  return entry;
}

export function isCurrentPageDocument(entry, pageId) {
  return entry?.scope === "page" && entry.pageIds?.includes(pageId) === true;
}

export function hubCategoryForDocument(entry) {
  if (["total-prd", "page-prd"].includes(entry?.kind)) return "prd";
  if (entry?.kind === "field-spec") return "field";
  if (entry?.kind === "api-doc") return "api";
  return "requirement";
}
