export const SDK_VERSION = "2.4.0";
export const SCHEMA_VERSION = 2;
export const UI_ATTRIBUTE = "data-prd-annotator-ui";
export const ANNOTATION_STATUSES = Object.freeze([
  "open",
  "needs-clarification",
  "applied",
  "superseded"
]);
export const IMPACT_SCOPES = Object.freeze(["page", "global"]);
export const ANNOTATION_TYPES = Object.freeze([
  "requirement",
  "change",
  "question",
  "bug"
]);
export const STORAGE_PREFIX = "prd-annotator:v2";
export const LEGACY_STORAGE_PREFIX = "prd-annotator:v1";
