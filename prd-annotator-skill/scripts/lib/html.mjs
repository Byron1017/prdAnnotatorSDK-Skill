import path from "node:path";

const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ID_PATTERN = /^[a-z0-9-]{1,32}$/;

function decodeAttribute(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseAttributes(script) {
  const openTag = /^<script\b([^>]*)>/i.exec(script)?.[1] || "";
  const attributes = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE_PATTERN.exec(openTag))) {
    const name = match[1].toLowerCase();
    attributes[name] = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function isIntegration(attributes) {
  const src = attributes.src || "";
  const sdkReference = /(?:^|\/)\.prd-annotator\/sdk\/prd-annotator\.js(?:[?#].*)?$/.test(src);
  const completeIdentity = Object.hasOwn(attributes, "data-project-id")
    && Object.hasOwn(attributes, "data-page-id")
    && Object.hasOwn(attributes, "data-view-src");
  return sdkReference || completeIdentity;
}

function assertProjectPath(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new Error(`${label} must be a project-relative path`);
  if (
    value.includes("\\")
    || value.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a safe project-relative path`);
  }
  return value;
}

function assertRelativeWebReference(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new Error(`${label} must be relative`);
  if (
    value.includes("\\")
    || value.startsWith("/")
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || value.split("/").some((segment) => !segment || segment === ".")
  ) {
    throw new Error(`${label} must be a local relative URL`);
  }
  return value;
}

function integrationScript(attrs) {
  assertRelativeWebReference(attrs?.src, "src");
  assertRelativeWebReference(attrs?.viewSrc, "data-view-src");
  if (typeof attrs?.projectId !== "string" || !attrs.projectId) throw new Error("data-project-id is required");
  if (typeof attrs?.pageId !== "string" || !attrs.pageId) throw new Error("data-page-id is required");
  return `<script src="${escapeAttribute(attrs.src)}" data-project-id="${escapeAttribute(attrs.projectId)}" data-page-id="${escapeAttribute(attrs.pageId)}" data-view-src="${escapeAttribute(attrs.viewSrc)}"></script>`;
}

export function relativeWebPath(fromHtmlPath, targetPath) {
  const htmlPath = assertProjectPath(fromHtmlPath, "fromHtmlPath");
  const destination = assertProjectPath(targetPath, "targetPath");
  const relative = path.posix.relative(path.posix.dirname(htmlPath), destination);
  if (!relative || path.posix.isAbsolute(relative)) throw new Error("Unable to calculate a safe relative web path");
  return relative;
}

export function inspectIntegration(html) {
  const source = String(html);
  const records = [];
  SCRIPT_PATTERN.lastIndex = 0;
  let match;
  while ((match = SCRIPT_PATTERN.exec(source))) {
    const attributes = parseAttributes(match[0]);
    if (!isIntegration(attributes)) continue;
    records.push({
      src: attributes.src || "",
      projectId: attributes["data-project-id"] || "",
      pageId: attributes["data-page-id"] || "",
      viewSrc: attributes["data-view-src"] || "",
      validPageId: ID_PATTERN.test(attributes["data-page-id"] || ""),
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0]
    });
  }
  return records;
}

export function upsertIntegration(html, attrs) {
  const source = String(html);
  const integrations = inspectIntegration(source);
  if (integrations.length > 1) throw new Error("HTML contains more than one PRD Annotator script");
  const script = integrationScript(attrs);
  if (integrations.length === 1) {
    const [integration] = integrations;
    return `${source.slice(0, integration.start)}${script}${source.slice(integration.end)}`;
  }
  const bodyClose = /<\/body\s*>/i.exec(source);
  if (bodyClose) {
    return `${source.slice(0, bodyClose.index)}${script}\n${source.slice(bodyClose.index)}`;
  }
  const separator = source && !source.endsWith("\n") ? "\n" : "";
  return `${source}${separator}${script}\n`;
}

export function removeIntegration(html) {
  const source = String(html);
  const integrations = inspectIntegration(source);
  if (integrations.length > 1) throw new Error("HTML contains more than one PRD Annotator script");
  if (!integrations.length) return source;
  const [integration] = integrations;
  return `${source.slice(0, integration.start)}${source.slice(integration.end)}`;
}
