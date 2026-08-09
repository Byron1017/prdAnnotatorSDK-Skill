import { readFile } from "node:fs/promises";
import path from "node:path";

const STATUS_VALUES = new Set([
  "open",
  "needs-clarification",
  "applied",
  "superseded"
]);
const IMPACT_VALUES = new Set(["page", "global"]);

function fail(message) {
  throw new Error(message);
}

function parseArguments(values) {
  if (values.length !== 2 || values[0] !== "--project-root" || !values[1]) {
    fail("Usage: check-prd.mjs --project-root PATH");
  }
  return path.resolve(values[1]);
}

function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} resolves outside ${root}`);
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    fail(`${filePath}: ${error.message}`);
  }
}

async function readJson(filePath) {
  const source = await readText(filePath);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${filePath}: ${error.message}`);
  }
}

function assertNonEmptyString(value, filePath, field) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${filePath}: ${field} must be a non-empty string`);
  }
}

function normalizeRoute(route) {
  const normalized = `/${String(route || "").split(/[?#]/, 1)[0]}`
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return normalized || "/";
}

function assertAnnotation(annotation, filePath) {
  assertNonEmptyString(annotation?.id, filePath, "annotation.id");
  assertNonEmptyString(annotation?.comment, filePath, `annotation ${annotation?.id}.comment`);
  assertNonEmptyString(annotation?.createdAt, filePath, `annotation ${annotation?.id}.createdAt`);
  assertNonEmptyString(annotation?.updatedAt, filePath, `annotation ${annotation?.id}.updatedAt`);
  if (!STATUS_VALUES.has(annotation.status)) {
    fail(`${filePath}: annotation ${annotation.id} has invalid status`);
  }
  if (!annotation.target || typeof annotation.target !== "object") {
    fail(`${filePath}: annotation ${annotation.id}.target is required`);
  }
  assertNonEmptyString(
    annotation.target.cssPath,
    filePath,
    `annotation ${annotation.id}.target.cssPath`
  );
  assertNonEmptyString(
    annotation.target.xpath,
    filePath,
    `annotation ${annotation.id}.target.xpath`
  );
  if (!annotation.target.rect || typeof annotation.target.rect !== "object") {
    fail(`${filePath}: annotation ${annotation.id}.target.rect is required`);
  }
  if (!annotation.prd || !IMPACT_VALUES.has(annotation.prd.impactScope)) {
    fail(`${filePath}: annotation ${annotation.id} has invalid impact scope`);
  }
  if (!Array.isArray(annotation.prd.linkedSections)) {
    fail(`${filePath}: annotation ${annotation.id}.prd.linkedSections must be an array`);
  }
  if (annotation.status === "applied" && annotation.prd.linkedSections.length === 0) {
    fail(`${filePath}: applied annotation ${annotation.id} must link to a PRD section`);
  }
}

function assertDocument(document, pageEntry, filePath) {
  if (document?.schemaVersion !== 1) fail(`${filePath}: unsupported schemaVersion`);
  if (document.page?.id !== pageEntry.id) {
    fail(`${filePath}: page.id must equal manifest id ${pageEntry.id}`);
  }
  assertNonEmptyString(document.page.title, filePath, "page.title");
  if (normalizeRoute(document.page.route) !== normalizeRoute(pageEntry.route)) {
    fail(`${filePath}: page.route must equal manifest route ${pageEntry.route}`);
  }
  if (!Array.isArray(document.annotations)) {
    fail(`${filePath}: annotations must be an array`);
  }
  const annotationIds = new Set();
  for (const annotation of document.annotations) {
    assertAnnotation(annotation, filePath);
    if (annotationIds.has(annotation.id)) {
      fail(`${filePath}: duplicate annotation id ${annotation.id}`);
    }
    annotationIds.add(annotation.id);
  }
  return document.annotations.length;
}

async function main() {
  const projectRoot = parseArguments(process.argv.slice(2));
  const prdRoot = path.resolve(projectRoot, "doc/prd");
  const manifestPath = path.resolve(prdRoot, "manifest.json");
  const totalPrdPath = path.resolve(prdRoot, "PRD.md");
  const manifest = await readJson(manifestPath);
  if (manifest?.schemaVersion !== 1) fail(`${manifestPath}: unsupported schemaVersion`);
  if (!Array.isArray(manifest.pages)) fail(`${manifestPath}: pages must be an array`);

  const pageIds = new Set();
  const routes = new Set();
  const totalPrd = await readText(totalPrdPath);
  if (!totalPrd.trim()) fail(`${totalPrdPath}: total PRD must not be empty`);
  let annotationCount = 0;

  for (const pageEntry of manifest.pages) {
    if (!/^[a-z0-9-]{1,40}$/.test(pageEntry?.id || "")) {
      fail(`${manifestPath}: invalid page id ${pageEntry?.id || "<missing>"}`);
    }
    assertNonEmptyString(pageEntry.title, manifestPath, `page ${pageEntry.id}.title`);
    assertNonEmptyString(pageEntry.route, manifestPath, `page ${pageEntry.id}.route`);
    if (pageIds.has(pageEntry.id)) fail(`${manifestPath}: duplicate page id ${pageEntry.id}`);
    const route = normalizeRoute(pageEntry.route);
    if (routes.has(route)) fail(`${manifestPath}: duplicate page route ${route}`);
    pageIds.add(pageEntry.id);
    routes.add(route);

    const expectedAnnotationFile = `data/pages/${pageEntry.id}.json`;
    const expectedPrdFile = `pages/${pageEntry.id}.md`;
    if (pageEntry.annotationFile !== expectedAnnotationFile) {
      fail(`${manifestPath}: page ${pageEntry.id}.annotationFile must be ${expectedAnnotationFile}`);
    }
    if (pageEntry.prdFile !== expectedPrdFile) {
      fail(`${manifestPath}: page ${pageEntry.id}.prdFile must be ${expectedPrdFile}`);
    }

    const annotationPath = path.resolve(prdRoot, pageEntry.annotationFile);
    const pagePrdPath = path.resolve(prdRoot, pageEntry.prdFile);
    assertInside(prdRoot, annotationPath, "Annotation file");
    assertInside(prdRoot, pagePrdPath, "Page PRD file");
    annotationCount += assertDocument(
      await readJson(annotationPath),
      pageEntry,
      annotationPath
    );

    const pagePrd = await readText(pagePrdPath);
    if (!pagePrd.trim()) fail(`${pagePrdPath}: page PRD must not be empty`);
    const expectedLink = `[${pageEntry.title}](${pageEntry.prdFile})`;
    if (!totalPrd.includes(expectedLink)) {
      fail(`${totalPrdPath}: PRD.md must include ${expectedLink}`);
    }
  }

  console.log(
    `PRD gate passed: ${manifest.pages.length} pages, ${annotationCount} annotations`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
