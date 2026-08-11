const ROUTE_REQUIREMENTS = "must be a non-empty, trimmed, single-line route starting with / and containing no backslashes";

function hasBrowserQuery(value) {
  return value.split("/").some((segment) => (
    segment.includes("?")
    && !/^:[a-zA-Z_][\w]*\?$/.test(segment)
  ));
}

function cleanAscii(value, maxLength) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/-$/g, "");
}

function fnvHex(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function assertValidRoute(value, label = "route") {
  if (
    typeof value !== "string"
    || !value
    || value !== value.trim()
    || /[\r\n]/.test(value)
    || !value.startsWith("/")
    || value.includes("\\")
    || value.includes("#")
    || hasBrowserQuery(value)
  ) {
    throw new Error(`${label} ${ROUTE_REQUIREMENTS}`);
  }
  return value;
}

export function deriveRoutePageId(htmlPath, routePattern, usedIds = new Set()) {
  const route = assertValidRoute(routePattern, "routePattern");
  const normalizedHtmlPath = String(htmlPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const staticSegments = route
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":"));
  const htmlStem = normalizedHtmlPath
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "");
  const slug = cleanAscii(staticSegments.slice(-2).join("-") || htmlStem, 25) || "route";
  const suffix = fnvHex(`${normalizedHtmlPath}#${route}`).slice(0, 6);
  let attempt = 1;
  while (true) {
    const collisionSuffix = attempt === 1 ? "" : `-${attempt}`;
    const availableSlugLength = 32 - 1 - suffix.length - collisionSuffix.length;
    const result = `${slug.slice(0, availableSlugLength)}-${suffix}${collisionSuffix}`;
    if (!usedIds.has(result)) {
      usedIds.add(result);
      return result;
    }
    attempt += 1;
  }
}
