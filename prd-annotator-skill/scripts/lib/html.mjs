import path from "node:path";

const ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const INERT_ELEMENTS = new Set(["iframe", "noscript", "template", "textarea", "xmp"]);
const JAVASCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript"
]);

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

function findTagEnd(source, start) {
  let quote = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return -1;
}

function parseTag(source, start) {
  const end = findTagEnd(source, start);
  if (end < 0) return null;
  const raw = source.slice(start, end);
  const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(raw);
  if (!match) return { start, end, raw, name: "", closing: false, selfClosing: false };
  return {
    start,
    end,
    raw,
    name: match[2].toLowerCase(),
    closing: Boolean(match[1]),
    selfClosing: /\/\s*>$/.test(raw)
  };
}

function isExecutableScript(attributes) {
  const type = (attributes.type || "").trim().toLowerCase();
  return !type || type === "module" || JAVASCRIPT_TYPES.has(type.split(";", 1)[0].trim());
}

function executableScripts(html) {
  const source = String(html);
  const scripts = [];
  const inertStack = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("<", index);
    if (start < 0) break;
    if (source.startsWith("<!--", start)) {
      const commentEnd = source.indexOf("-->", start + 4);
      index = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const tag = parseTag(source, start);
    if (!tag) break;
    index = tag.end;
    if (!tag.name) continue;

    if (inertStack.length) {
      if (tag.closing && tag.name === inertStack[inertStack.length - 1]) inertStack.pop();
      else if (!tag.closing && !tag.selfClosing && INERT_ELEMENTS.has(tag.name)) inertStack.push(tag.name);
      continue;
    }
    if (!tag.closing && !tag.selfClosing && INERT_ELEMENTS.has(tag.name)) {
      inertStack.push(tag.name);
      continue;
    }
    if (tag.closing || tag.name !== "script") continue;

    const closePattern = /<\/script\s*>/gi;
    closePattern.lastIndex = tag.end;
    const close = closePattern.exec(source);
    if (!close) break;
    const end = close.index + close[0].length;
    const attributes = parseAttributes(tag.raw);
    if (isExecutableScript(attributes)) scripts.push({ start: tag.start, end, raw: source.slice(tag.start, end), attributes });
    index = end;
  }
  return scripts;
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
  const records = [];
  for (const script of executableScripts(html)) {
    const { attributes } = script;
    if (!isIntegration(attributes)) continue;
    records.push({
      src: attributes.src || "",
      projectId: attributes["data-project-id"] || "",
      pageId: attributes["data-page-id"] || "",
      viewSrc: attributes["data-view-src"] || "",
      validPageId: ID_PATTERN.test(attributes["data-page-id"] || ""),
      start: script.start,
      end: script.end,
      raw: script.raw
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
