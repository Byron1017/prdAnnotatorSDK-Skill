function fnv1a(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableHex(value, length) {
  return `${fnv1a(value)}${fnv1a(`prd:${value}`, 0x9e3779b9)}`.slice(0, length);
}

export function normalizeRoute(pathname = "/") {
  const pathOnly = String(pathname).split(/[?#]/, 1)[0] || "/";
  const normalized = `/${pathOnly}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function cleanAscii(value, maxLength = 40) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
}

export function resolvePageIdFromSeed({ slug = "page", seed = "" } = {}) {
  const cleanSlug = cleanAscii(slug, 25) || "page";
  return `${cleanSlug}-${stableHex(String(seed), 6)}`.slice(0, 32);
}

export function resolveLegacyPageId({ explicitId, pathname = "/", manifestPages = [] }) {
  const explicit = cleanAscii(explicitId);
  if (explicit) return explicit;

  const route = normalizeRoute(pathname);
  const existing = manifestPages.find((page) => normalizeRoute(page.route) === route);
  const existingId = cleanAscii(existing?.id);
  if (existingId) return existingId;

  const segments = route.split("/").filter(Boolean).reverse();
  const slug = segments.map((segment) => cleanAscii(segment, 26)).find(Boolean);
  return slug
    ? `p-${slug}-${stableHex(route, 6)}`.slice(0, 40)
    : `p-${stableHex(route, 10)}`;
}

export function resolvePageId({ explicitId, pathname = "/", manifestPages = [] }) {
  const explicit = cleanAscii(explicitId, 32);
  if (explicit) return explicit;

  const route = normalizeRoute(pathname);
  const existing = manifestPages.find((page) => normalizeRoute(page.route) === route);
  const existingId = cleanAscii(existing?.id, 32);
  if (existingId) return existingId;

  const segments = route.split("/").filter(Boolean).reverse();
  const slug = segments
    .map((segment) => cleanAscii(segment.replace(/\.[^.]+$/, ""), 25))
    .find(Boolean);
  return slug
    ? `${slug}-${stableHex(route, 6)}`.slice(0, 32)
    : `page-${stableHex(route, 6)}`;
}

export function resolveLegacyProjectKey({ explicitProjectId, scriptSrc = "" }) {
  const explicit = cleanAscii(explicitProjectId, 48);
  if (explicit) return explicit;
  const sdkDirectory = String(scriptSrc).replace(/[^/]*$/, "");
  return `project-${stableHex(sdkDirectory, 10)}`;
}

export function resolveProjectKey(options) {
  return resolveLegacyProjectKey(options);
}
