export const DOCUMENT_SCOPES = new Set(["page", "global", "unassigned"]);

const GLOBAL_ONLY_KINDS = new Set(["total-prd", "public", "public-rule"]);

export function inferDocumentScope(entry = {}) {
  if (entry.scope !== undefined) {
    if (!DOCUMENT_SCOPES.has(entry.scope)) throw new Error("invalid document scope");
    return entry.scope;
  }
  if (Array.isArray(entry.pageIds) && entry.pageIds.length) return "page";
  if (GLOBAL_ONLY_KINDS.has(entry.kind)) return "global";
  return "unassigned";
}

export function normalizeDocumentScope(entry = {}) {
  return { ...entry, scope: inferDocumentScope(entry) };
}

export function validateDocumentScope(entry, knownPageIds) {
  const scope = inferDocumentScope(entry);
  const pageIds = Array.isArray(entry.pageIds) ? entry.pageIds : [];
  if (scope === "page" && !pageIds.length) throw new Error("page scope requires pageIds");
  if (scope !== "page" && pageIds.length) throw new Error(`${scope} scope requires empty pageIds`);
  if (entry.kind === "page-prd" && scope === "global") throw new Error("page-prd cannot be global");
  if (GLOBAL_ONLY_KINDS.has(entry.kind) && scope !== "global") throw new Error(`${entry.kind} must be global`);
  if (entry.kind === "unclassified" && scope !== "unassigned") throw new Error("unclassified must be unassigned");
  if (knownPageIds) {
    for (const pageId of pageIds) {
      if (!knownPageIds.has(pageId)) throw new Error(`unknown pageId: ${pageId}`);
    }
  }
  return scope;
}

export function documentBelongsToPage(entry, pageId) {
  return inferDocumentScope(entry) === "page" && entry.pageIds?.includes(pageId) === true;
}
