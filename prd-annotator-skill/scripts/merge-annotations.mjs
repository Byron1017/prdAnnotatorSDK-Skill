import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!["--project-root", "--snapshot"].includes(flag) || !value) {
      fail("Usage: merge-annotations.mjs --project-root PATH --snapshot PATH");
    }
    if (parsed[flag]) fail(`Duplicate argument: ${flag}`);
    parsed[flag] = value;
  }
  if (!parsed["--project-root"] || !parsed["--snapshot"]) {
    fail("Usage: merge-annotations.mjs --project-root PATH --snapshot PATH");
  }
  return parsed;
}

function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} resolves outside ${root}`);
  }
}

async function readJson(filePath, optional = false) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    fail(`${filePath}: ${error.message}`);
  }
}

function assertNonEmptyString(value, filePath, field) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${filePath}: ${field} must be a non-empty string`);
  }
}

function assertAnnotation(annotation, filePath) {
  assertNonEmptyString(annotation?.id, filePath, "annotation.id");
  assertNonEmptyString(annotation?.comment, filePath, `annotation ${annotation?.id}.comment`);
  assertNonEmptyString(annotation?.createdAt, filePath, `annotation ${annotation?.id}.createdAt`);
  assertNonEmptyString(annotation?.updatedAt, filePath, `annotation ${annotation?.id}.updatedAt`);
  if (Number.isNaN(Date.parse(annotation.updatedAt))) {
    fail(`${filePath}: annotation ${annotation.id}.updatedAt must be a valid date`);
  }
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
}

function assertDocument(document, filePath) {
  if (document?.schemaVersion !== 1) fail(`${filePath}: unsupported schemaVersion`);
  if (!/^[a-z0-9-]{1,40}$/.test(document.page?.id || "")) {
    fail(`${filePath}: invalid page.id`);
  }
  assertNonEmptyString(document.page.title, filePath, "page.title");
  assertNonEmptyString(document.page.route, filePath, "page.route");
  if (!Array.isArray(document.annotations)) {
    fail(`${filePath}: annotations must be an array`);
  }
  const ids = new Set();
  for (const annotation of document.annotations) {
    assertAnnotation(annotation, filePath);
    if (ids.has(annotation.id)) fail(`${filePath}: duplicate annotation id ${annotation.id}`);
    ids.add(annotation.id);
  }
  return document;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const projectRoot = path.resolve(args["--project-root"]);
  const snapshotPath = path.resolve(args["--snapshot"]);
  const snapshot = await readJson(snapshotPath);
  if (snapshot?.schemaVersion !== 1) fail(`${snapshotPath}: unsupported snapshot schemaVersion`);
  const incoming = assertDocument(snapshot.document, snapshotPath);

  const permanentRoot = path.resolve(projectRoot, "doc/prd");
  const permanentPath = path.resolve(
    permanentRoot,
    "data/pages",
    `${incoming.page.id}.json`
  );
  assertInside(permanentRoot, permanentPath, "Permanent annotation file");

  const existingValue = await readJson(permanentPath, true);
  const existing = existingValue
    ? assertDocument(existingValue, permanentPath)
    : {
        schemaVersion: 1,
        page: clone(incoming.page),
        annotations: []
      };
  if (existing.page.id !== incoming.page.id) {
    fail(`${permanentPath}: cannot merge different page ids`);
  }

  const byId = new Map(
    existing.annotations.map((annotation) => [annotation.id, clone(annotation)])
  );
  for (const candidate of incoming.annotations) {
    const current = byId.get(candidate.id);
    if (!current || Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt)) {
      byId.set(candidate.id, clone(candidate));
    }
  }

  const merged = {
    schemaVersion: 1,
    page: { ...clone(existing.page), ...clone(incoming.page), id: existing.page.id },
    annotations: [...byId.values()]
  };
  if (merged.annotations.length < existing.annotations.length) {
    fail(`${permanentPath}: merge cannot reduce the permanent annotation count`);
  }

  await mkdir(path.dirname(permanentPath), { recursive: true });
  await writeFile(permanentPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(
    `Merged ${incoming.page.id}: ${existing.annotations.length} existing, `
    + `${incoming.annotations.length} incoming, ${merged.annotations.length} total`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
