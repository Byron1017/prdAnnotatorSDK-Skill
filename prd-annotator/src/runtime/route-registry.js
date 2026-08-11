import {
  isRelativeViewScriptSource,
  loadViewScript
} from "../view-data.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isProjectRelativePath(value) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-zA-Z]:[\\/]/.test(value)
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    && !value.split(/[\\/]+/).includes("..");
}

function assertPageReference(page, label) {
  assert(page && typeof page === "object", `Invalid ${label}`);
  assert(/^[a-z0-9-]{1,32}$/.test(page.id || ""), `Invalid ${label}.id`);
  assert(typeof page.title === "string" && page.title.trim(), `Invalid ${label}.title`);
  assert(isRelativeViewScriptSource(page.viewSrc), `${label}.viewSrc must be relative`);
}

function assertRoutePattern(value) {
  assert(
    typeof value === "string"
      && value === value.trim()
      && value.startsWith("/")
      && !value.includes("\\")
      && !/[\r\n#]/.test(value),
    "Invalid route pattern"
  );
}

export function assertValidRouteRegistry(value, expected = {}) {
  assert(value && typeof value === "object", "Invalid route registry");
  assert(value.schemaVersion === 2, "Unsupported route registry schemaVersion");
  assert(typeof value.projectId === "string" && value.projectId.trim(), "Invalid route registry projectId");
  if (expected.projectId !== undefined) {
    assert(value.projectId === expected.projectId, "Route registry projectId mismatch");
  }
  assert(isProjectRelativePath(value.htmlPath), "Invalid route registry htmlPath");
  assertPageReference(value.basePage, "route registry basePage");
  assert(value.basePage.htmlPath === value.htmlPath, "Route registry basePage htmlPath mismatch");
  if (expected.pageId !== undefined) {
    assert(value.basePage.id === expected.pageId, "Route registry pageId mismatch");
  }
  assert(Array.isArray(value.routes), "Invalid route registry routes");

  const ids = new Set([value.basePage.id]);
  const patterns = new Set();
  for (const route of value.routes) {
    assertPageReference(route, "route registry page");
    assert(!ids.has(route.id), "Duplicate route page id");
    assertRoutePattern(route.routePattern);
    assert(!patterns.has(route.routePattern), "Duplicate route pattern");
    ids.add(route.id);
    patterns.add(route.routePattern);
  }
  return value;
}

export async function loadRouteRegistryScript({
  window,
  document,
  src,
  expected
}) {
  delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  try {
    await loadViewScript({
      document,
      src,
      loaderDataset: "prdAnnotatorRouteLoader"
    });
    return assertValidRouteRegistry(
      window.__PRD_ANNOTATOR_ROUTE_REGISTRY__,
      expected
    );
  } finally {
    delete window.__PRD_ANNOTATOR_ROUTE_REGISTRY__;
  }
}
