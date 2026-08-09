import {
  ANNOTATION_STATUSES,
  IMPACT_SCOPES,
  SCHEMA_VERSION
} from "./constants.js";

export function createEmptyDocument(page) {
  return {
    schemaVersion: SCHEMA_VERSION,
    page: {
      id: String(page.id),
      title: String(page.title || page.id),
      route: String(page.route || "/")
    },
    annotations: []
  };
}

export function assertValidDocument(document) {
  if (document?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported schemaVersion");
  }
  if (!document.page?.id || !/^[a-z0-9-]{1,40}$/.test(document.page.id)) {
    throw new Error("Invalid page.id");
  }
  if (!Array.isArray(document.annotations)) {
    throw new Error("annotations must be an array");
  }
  for (const annotation of document.annotations) {
    if (!annotation.id || !annotation.comment || !annotation.target) {
      throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
    }
    if (!ANNOTATION_STATUSES.includes(annotation.status)) {
      throw new Error("Invalid annotation status");
    }
    if (!IMPACT_SCOPES.includes(annotation.prd?.impactScope)) {
      throw new Error("Invalid impact scope");
    }
  }
  return document;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function mergeAnnotationDocuments(base, incoming) {
  assertValidDocument(base);
  assertValidDocument(incoming);
  if (base.page.id !== incoming.page.id) {
    throw new Error("Cannot merge different pages");
  }

  const annotationsById = new Map(
    base.annotations.map((item) => [item.id, clone(item)])
  );
  for (const candidate of incoming.annotations) {
    const current = annotationsById.get(candidate.id);
    if (!current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)) {
      annotationsById.set(candidate.id, clone(candidate));
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    page: { ...base.page, ...incoming.page, id: base.page.id },
    annotations: [...annotationsById.values()]
  };
}
