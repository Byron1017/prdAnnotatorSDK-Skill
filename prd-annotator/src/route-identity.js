import { normalizeRoute, resolvePageIdFromSeed } from "./identity.js";

export function normalizeHashLocation(hash = "") {
  const raw = String(hash || "");
  if (!raw || raw === "#") return { kind: "none", path: "" };

  const body = raw.startsWith("#!") ? raw.slice(2) : raw.slice(1);
  if (!body.startsWith("/")) return { kind: "anchor", path: body };

  return { kind: "route", path: normalizeRoute(body) };
}

function patternSegments(pattern) {
  const normalized = `/${String(pattern || "")}`
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return normalized.split("/").filter(Boolean);
}

export function matchRoutePattern(pattern, candidate) {
  const expected = patternSegments(pattern);
  const actual = patternSegments(candidate);
  let actualIndex = 0;

  for (const segment of expected) {
    if (/^:[a-zA-Z_][\w]*(?:\(\.\*\))?\*$/.test(segment)) return true;

    const optional = /^:[a-zA-Z_][\w]*\?$/.test(segment);
    if (optional && actualIndex >= actual.length) continue;
    if (actualIndex >= actual.length) return false;
    if (!segment.startsWith(":") && segment !== actual[actualIndex]) return false;
    actualIndex += 1;
  }

  return actualIndex === actual.length;
}

export function resolveLocationIdentity({
  pathname = "/",
  hash = "",
  basePage,
  routes = []
}) {
  const hashLocation = normalizeHashLocation(hash);

  if (hashLocation.kind !== "route") {
    return {
      ...basePage,
      pageId: basePage.id,
      route: normalizeRoute(pathname),
      routePattern: null,
      mode: "document",
      registered: true
    };
  }

  const matches = routes.filter((entry) =>
    matchRoutePattern(entry.routePattern, hashLocation.path));
  if (matches.length > 1) {
    throw new Error(`Ambiguous PRD Annotator route: ${hashLocation.path}`);
  }
  if (matches.length === 1) {
    const page = matches[0];
    return {
      ...page,
      pageId: page.id,
      htmlPath: basePage.htmlPath,
      route: hashLocation.path,
      routePattern: page.routePattern,
      mode: "hash-route",
      registered: true
    };
  }

  const pageId = resolvePageIdFromSeed({
    slug: "unknown",
    seed: `${normalizeRoute(pathname)}#${hashLocation.path}`
  });
  return {
    pageId,
    title: hashLocation.path,
    htmlPath: basePage.htmlPath,
    route: hashLocation.path,
    routePattern: null,
    mode: "hash-route",
    registered: false,
    viewSrc: ""
  };
}
