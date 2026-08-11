import { relativeWebPath } from "./html.mjs";
import { canonicalJson, normalizePageIdentity } from "./schema.mjs";

function compareRoutePatterns(left, right) {
  return left.routePattern < right.routePattern
    ? -1
    : left.routePattern > right.routePattern
      ? 1
      : 0;
}

function pageReference(page, basePage) {
  return {
    id: page.id,
    title: page.title,
    htmlPath: page.htmlPath,
    viewSrc: relativeWebPath(basePage.htmlPath, page.viewFile)
  };
}

export function buildRouteRegistry({ manifest, basePage } = {}) {
  if (!manifest?.project?.id || !basePage?.id) {
    throw new Error("Invalid route registry inputs");
  }
  const registeredBase = manifest.pages?.find((page) => page.id === basePage.id);
  if (!registeredBase || normalizePageIdentity(registeredBase).mode !== "document") {
    throw new Error("Route registry base page is not registered as a document page");
  }
  const routes = manifest.pages
    .filter((page) => (
      page.htmlPath === registeredBase.htmlPath
      && page.display?.enabled === true
      && normalizePageIdentity(page).mode === "hash-route"
    ))
    .map((page) => ({
      ...pageReference(page, registeredBase),
      routePattern: normalizePageIdentity(page).routePattern
    }))
    .sort(compareRoutePatterns);
  return {
    schemaVersion: 2,
    projectId: manifest.project.id,
    htmlPath: registeredBase.htmlPath,
    basePage: pageReference(registeredBase, registeredBase),
    routes
  };
}

export function serializeRouteRegistry(bundle) {
  return `window.__PRD_ANNOTATOR_ROUTE_REGISTRY__=${canonicalJson(bundle)};\n`;
}
