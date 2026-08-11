import {
  ANNOTATION_TYPES,
  ANNOTATION_STATUSES,
  IMPACT_SCOPES,
  SCHEMA_VERSION
} from "./constants.js";

const OPTIONAL_ANNOTATION_TEXT_FIELDS = [
  "note",
  "acceptanceCriteria",
  "dataFields",
  "apiPath",
  "edgeCases"
];

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function asPage(value = {}, defaults = {}) {
  const route = String(value.route || defaults.route || "/");
  return {
    id: String(value.id || defaults.id || ""),
    title: String(value.title || defaults.title || value.id || defaults.id || ""),
    htmlPath: String(value.htmlPath || defaults.htmlPath || "/"),
    route
  };
}

function normalizeAnnotation(annotation = {}) {
  const comment = String(annotation.comment || "");
  const prd = annotation.prd || {};
  return {
    ...clone(annotation),
    id: String(annotation.id || ""),
    title: String(annotation.title || comment),
    description: String(annotation.description || comment),
    type: ANNOTATION_TYPES.includes(annotation.type) ? annotation.type : "requirement",
    prdContent: String(annotation.prdContent || comment),
    status: ANNOTATION_STATUSES.includes(annotation.status) ? annotation.status : "open",
    createdAt: String(annotation.createdAt || ""),
    updatedAt: String(annotation.updatedAt || annotation.createdAt || ""),
    target: clone(annotation.target || {
      cssPath: "",
      xpath: "",
      textQuote: "",
      rect: { x: 0, y: 0, width: 0, height: 0 }
    }),
    prd: {
      ...clone(prd),
      linkedDocuments: Array.isArray(prd.linkedDocuments) ? clone(prd.linkedDocuments) : [],
      linkedSections: Array.isArray(prd.linkedSections) ? clone(prd.linkedSections) : [],
      impactScope: IMPACT_SCOPES.includes(prd.impactScope) ? prd.impactScope : "page",
      summary: String(prd.summary || "")
    }
  };
}

function normalizeDeletedAnnotation(value = {}) {
  return {
    id: String(value.id || ""),
    deletedAt: String(value.deletedAt || "")
  };
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== "string"
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function annotationFingerprintInput(document = {}) {
  const annotations = clone(
    Array.isArray(document.annotations) ? document.annotations : []
  );
  const deletedAnnotations = clone(
    Array.isArray(document.deletedAnnotations) ? document.deletedAnnotations : []
  );
  return deletedAnnotations.length
    ? { annotations, deletedAnnotations }
    : annotations;
}

export function annotationDisplayNumber(annotation, fallbackIndex = 0) {
  const match = /^A(\d+)$/.exec(String(annotation?.id || ""));
  return match ? String(Number(match[1])) : String(fallbackIndex + 1);
}

export function createEmptyDocument(options = {}) {
  const { projectId, page } = options;
  const pageValue = page || options;
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: projectId === undefined ? undefined : String(projectId),
    page: asPage(pageValue),
    annotations: [],
    deletedAnnotations: [],
    managedPrd: null
  };
}

export function normalizeAnnotationDocument(value, defaults = {}) {
  const source = value || {};
  const pageDefaults = defaults.page || defaults;
  return {
    ...clone(source),
    schemaVersion: SCHEMA_VERSION,
    projectId: String(source.projectId || defaults.projectId || ""),
    page: asPage(source.page, pageDefaults),
    annotations: Array.isArray(source.annotations)
      ? source.annotations.map(normalizeAnnotation)
      : [],
    deletedAnnotations: Array.isArray(source.deletedAnnotations)
      ? source.deletedAnnotations.map(normalizeDeletedAnnotation)
      : [],
    managedPrd: source.managedPrd === undefined ? null : clone(source.managedPrd)
  };
}

export function assertValidDocument(document) {
  if (document?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported schemaVersion");
  }
  if (!document.page?.id || !/^[a-z0-9-]{1,32}$/.test(document.page.id)) {
    throw new Error("Invalid page.id");
  }
  if (!Array.isArray(document.annotations)) {
    throw new Error("annotations must be an array");
  }
  if (
    document.deletedAnnotations !== undefined
    && !Array.isArray(document.deletedAnnotations)
  ) {
    throw new Error("deletedAnnotations must be an array");
  }
  const activeIds = new Set();
  for (const annotation of document.annotations) {
    if (
      !annotation.id
      || !annotation.title
      || !annotation.description
      || !annotation.prdContent
      || !annotation.target
    ) {
      throw new Error(`Invalid annotation ${annotation.id || "without-id"}`);
    }
    for (const field of OPTIONAL_ANNOTATION_TEXT_FIELDS) {
      if (
        Object.prototype.hasOwnProperty.call(annotation, field)
        && typeof annotation[field] !== "string"
      ) {
        throw new Error(`Invalid annotation ${annotation.id}.${field}`);
      }
    }
    if (!["cssPath", "xpath", "textQuote"].some(
      (field) => typeof annotation.target[field] === "string"
        && annotation.target[field].trim()
    )) {
      throw new Error(`Invalid annotation ${annotation.id}.target`);
    }
    if (!ANNOTATION_TYPES.includes(annotation.type)) {
      throw new Error("Invalid annotation type");
    }
    if (!ANNOTATION_STATUSES.includes(annotation.status)) {
      throw new Error("Invalid annotation status");
    }
    if (!IMPACT_SCOPES.includes(annotation.prd?.impactScope)) {
      throw new Error("Invalid impact scope");
    }
    activeIds.add(annotation.id);
  }
  const deletedIds = new Set();
  for (const deletedAnnotation of document.deletedAnnotations || []) {
    if (!deletedAnnotation.id) {
      throw new Error("Invalid deleted annotation id");
    }
    if (deletedIds.has(deletedAnnotation.id)) {
      throw new Error(`Duplicate deleted annotation ${deletedAnnotation.id}`);
    }
    if (activeIds.has(deletedAnnotation.id)) {
      throw new Error(`Annotation ${deletedAnnotation.id} cannot be active and deleted`);
    }
    assertIsoTimestamp(
      deletedAnnotation.deletedAt,
      `deleted annotation ${deletedAnnotation.id}.deletedAt`
    );
    deletedIds.add(deletedAnnotation.id);
  }
  return document;
}

export function mergeAnnotationDocuments(base, incoming) {
  const normalizedBase = normalizeAnnotationDocument(base);
  const normalizedIncoming = normalizeAnnotationDocument(incoming, {
    projectId: normalizedBase.projectId,
    page: normalizedBase.page
  });
  assertValidDocument(normalizedBase);
  assertValidDocument(normalizedIncoming);
  if (normalizedBase.page.id !== normalizedIncoming.page.id) {
    throw new Error("Cannot merge different pages");
  }

  const annotationsById = new Map(
    normalizedBase.annotations.map((item) => [item.id, clone(item)])
  );
  for (const candidate of normalizedIncoming.annotations) {
    const current = annotationsById.get(candidate.id);
    if (!current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)) {
      annotationsById.set(candidate.id, clone(candidate));
    }
  }

  const tombstonesById = new Map(
    normalizedBase.deletedAnnotations.map((item) => [item.id, clone(item)])
  );
  for (const candidate of normalizedIncoming.deletedAnnotations) {
    const current = tombstonesById.get(candidate.id);
    if (!current || Date.parse(candidate.deletedAt) >= Date.parse(current.deletedAt)) {
      tombstonesById.set(candidate.id, clone(candidate));
    }
  }
  for (const id of tombstonesById.keys()) annotationsById.delete(id);

  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: normalizedIncoming.projectId || normalizedBase.projectId,
    page: {
      ...normalizedBase.page,
      ...normalizedIncoming.page,
      id: normalizedBase.page.id
    },
    annotations: [...annotationsById.values()],
    deletedAnnotations: [...tombstonesById.values()],
    managedPrd: normalizedIncoming.managedPrd ?? normalizedBase.managedPrd
  };
}
