import path from "node:path";
import { assertProjectRelativePath } from "./project-transaction.mjs";

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSingleLine(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  if (/\r|\n/.test(value)) fail(`${label} must be a single line`);
  return value;
}

function normalizeBlock(value) {
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

function escapeLabel(value) {
  return value.replace(/[\\[\]*_`<>~]/g, "\\$&");
}

export function validateManagedPrd(managedPrd, label = "managedPrd") {
  if (!isRecord(managedPrd)) fail(`${label} must be an object`);
  assertSingleLine(managedPrd.title, `${label}.title`);
  if (!Array.isArray(managedPrd.sections)) fail(`${label}.sections must be an array`);
  const sectionIds = new Set();
  for (const section of managedPrd.sections) {
    if (!isRecord(section)) fail(`${label}.sections must contain objects`);
    assertSingleLine(section.id, `${label}.section.id`);
    if (sectionIds.has(section.id)) fail(`${label} has duplicate section id ${section.id}`);
    sectionIds.add(section.id);
    assertSingleLine(section.title, `${label}.section ${section.id}.title`);
    if (!Array.isArray(section.blocks)) fail(`${label}.section ${section.id}.blocks must be an array`);
    if (section.blocks.some((block) => typeof block !== "string" || !block.trim())) {
      fail(`${label}.section ${section.id}.blocks must contain non-empty strings`);
    }
  }
  return managedPrd;
}

export function renderManagedPagePrd(document) {
  const managedPrd = document?.managedPrd;
  validateManagedPrd(managedPrd);
  const parts = [`# ${escapeLabel(managedPrd.title)}`];
  for (const section of managedPrd.sections) {
    const blocks = section.blocks.map(normalizeBlock);
    const sectionSource = blocks.length
      ? `## ${escapeLabel(section.title)}\n\n${blocks.join("\n\n")}`
      : `## ${escapeLabel(section.title)}`;
    parts.push(sectionSource);
  }
  return `${parts.join("\n\n").replace(/\n+$/g, "")}\n`;
}

export function renderManagedTotalPrd(manifest, totalPrdFile) {
  assertProjectRelativePath(totalPrdFile, "managedTotalPrdFile");
  if (!Array.isArray(manifest?.pages)) fail("manifest.pages must be an array");
  const links = manifest.pages.map((page) => {
    if (!page?.managedPrdFile) fail(`page ${page?.id || "<missing>"} must define managedPrdFile for managed total PRD`);
    assertProjectRelativePath(page.managedPrdFile, `page ${page.id}.managedPrdFile`);
    assertSingleLine(page.title, `page ${page.id}.title`);
    const relative = path.posix.relative(path.posix.dirname(totalPrdFile), page.managedPrdFile);
    if (!relative || path.posix.isAbsolute(relative)) fail(`Invalid managed PRD link for ${page.id}`);
    return `- [${escapeLabel(page.title)}](${relative.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
  });
  const prefix = "# Product Requirements\n\n## Page index";
  return links.length ? `${prefix}\n\n${links.join("\n")}\n` : `${prefix}\n`;
}
