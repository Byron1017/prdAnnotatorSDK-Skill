import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const skillRoot = path.join(repositoryRoot, "prd-annotator-skill");
const checkScript = path.join(skillRoot, "scripts/check-project.mjs");
const compatibilityScript = path.join(skillRoot, "scripts/check-prd.mjs");
const manifestRelativePath = ".prd-annotator/manifest.json";
const annotationRelativePath = ".prd-annotator/data/pages/equipment-ops-7c31fa.json";
const viewRelativePath = ".prd-annotator/view/pages/equipment-ops-7c31fa.js";
const htmlRelativePath = "prototype/index.html";
const sourcePrdRelativePath = "doc/prd/pages/equipment-ops.md";
const temporaryDirectories = [];
const linkPermissionErrors = new Set(["EACCES", "EPERM", "ENOTSUP"]);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function copyFixture() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "prd-gate-test-"));
  temporaryDirectories.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  cpSync(fixtureRoot, projectRoot, { recursive: true });
  return projectRoot;
}

function projectPath(projectRoot, relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runScript(script, args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function expectCheckFailure(projectRoot, expectedMessage, script = checkScript) {
  let failure;
  try {
    runScript(script, ["--project-root", projectRoot]);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeTruthy();
  expect(`${failure.stdout || ""}${failure.stderr || ""}`).toContain(expectedMessage);
}

function parseView(projectRoot) {
  const source = readFileSync(projectPath(projectRoot, viewRelativePath), "utf8");
  const prefix = "window.PRDAnnotator.hydrateView(";
  expect(source.startsWith(prefix)).toBe(true);
  expect(source.endsWith(");\n")).toBe(true);
  return JSON.parse(source.slice(prefix.length, -3));
}

function writeView(projectRoot, view) {
  writeFileSync(
    projectPath(projectRoot, viewRelativePath),
    `window.PRDAnnotator.hydrateView(${JSON.stringify(view)});\n`,
    "utf8"
  );
}

function replaceHtmlAttribute(projectRoot, attribute, value) {
  const htmlPath = projectPath(projectRoot, htmlRelativePath);
  const html = readFileSync(htmlPath, "utf8");
  writeFileSync(htmlPath, html.replace(
    new RegExp(`${attribute}=(['\"])[^'\"]*\\1`),
    `${attribute}="${value}"`
  ));
}

function stripIntegration(projectRoot) {
  const htmlPath = projectPath(projectRoot, htmlRelativePath);
  const html = readFileSync(htmlPath, "utf8");
  writeFileSync(htmlPath, html.replace(/<script\b[^>]*data-project-id[^>]*><\/script>\s*/i, ""));
}

function makeLink(target, linkPath, type) {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (linkPermissionErrors.has(error?.code)) return false;
    throw error;
  }
}

function snapshotFiles(root) {
  const result = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) result[path.relative(root, absolutePath)] = readFileSync(absolutePath);
    }
  }
  visit(root);
  return result;
}

describe("complete project gate", () => {
  it("returns counts and prints the exact success output through both CLIs", async () => {
    const projectRoot = copyFixture();

    await expect(checkProject({ projectRoot })).resolves.toEqual({ pages: 1, annotations: 1, documents: 2 });
    const expected = "PRD Annotator gate passed: 1 pages, 1 annotations, 2 documents";
    expect(runScript(checkScript, ["--project-root", projectRoot]).trim()).toBe(expected);
    expect(runScript(compatibilityScript, ["--project-root", projectRoot]).trim()).toBe(expected);
  });

  it("rejects an annotation missing PRD content", () => {
    const projectRoot = copyFixture();
    const annotationPath = projectPath(projectRoot, annotationRelativePath);
    const permanent = readJson(annotationPath);
    permanent.annotations[0].prdContent = "";
    writeJson(annotationPath, permanent);

    expectCheckFailure(projectRoot, "annotation A001.prdContent must be a non-empty string");
  });

  it("rejects malformed required fields, enums, dates, targets, and duplicate annotation ids", () => {
    const mutations = [
      [(item) => { item.title = ""; }, "annotation A001.title must be a non-empty string"],
      [(item) => { item.type = "idea"; }, "annotation A001.type must be one of"],
      [(item) => { item.status = "deleted"; }, "annotation A001.status must be one of"],
      [(item) => { item.createdAt = "yesterday"; }, "annotation A001.createdAt must be an ISO timestamp"],
      [(item) => { item.updatedAt = "2026-08-09"; }, "annotation A001.updatedAt must be an ISO timestamp"],
      [(item) => { delete item.target.xpath; }, "annotation A001.target.xpath must be a string"],
      [(item) => { item.target.rect.width = "wide"; }, "annotation A001.target.rect.width must be a finite number"],
      [(item) => { item.prd.impactScope = "feature"; }, "annotation A001.prd.impactScope must be one of"],
      [(item) => { item.prd.linkedDocuments = "doc-page-primary"; }, "annotation A001.prd.linkedDocuments must be an array"]
    ];

    for (const [mutate, expected] of mutations) {
      const projectRoot = copyFixture();
      const annotationPath = projectPath(projectRoot, annotationRelativePath);
      const permanent = readJson(annotationPath);
      mutate(permanent.annotations[0]);
      writeJson(annotationPath, permanent);
      expectCheckFailure(projectRoot, expected);
    }

    const duplicateProject = copyFixture();
    const duplicatePath = projectPath(duplicateProject, annotationRelativePath);
    const duplicate = readJson(duplicatePath);
    duplicate.annotations.push({ ...duplicate.annotations[0] });
    writeJson(duplicatePath, duplicate);
    expectCheckFailure(duplicateProject, "duplicate annotation id A001");
  });

  it("rejects invalid or duplicate manifest identities", () => {
    const cases = [
      [(manifest) => { manifest.project.id = "Bad Project"; }, "Invalid project.id"],
      [(manifest) => { manifest.pages[0].id = "设备页面"; }, "Invalid page.id"],
      [(manifest) => { manifest.pages[0].id = "a".repeat(33); }, "Invalid page.id"],
      [(manifest) => { manifest.pages.push({ ...manifest.pages[0] }); }, "Invalid page.id"],
      [(manifest) => { manifest.documents.push({ ...manifest.documents[0] }); }, "duplicate document id doc-total-primary"],
      [(manifest) => { manifest.documents.push({ ...manifest.documents[0], id: "other-document" }); }, "duplicate document path doc/prd/PRD.md"]
    ];
    for (const [mutate, expected] of cases) {
      const projectRoot = copyFixture();
      const manifestPath = projectPath(projectRoot, manifestRelativePath);
      const manifest = readJson(manifestPath);
      mutate(manifest);
      writeJson(manifestPath, manifest);
      expectCheckFailure(projectRoot, expected);
    }
  });

  it("rejects stale SDK bytes or invalid exact release metadata", () => {
    const staleProject = copyFixture();
    appendFileSync(projectPath(staleProject, ".prd-annotator/sdk/prd-annotator.js"), "changed\n");
    expectCheckFailure(staleProject, "SDK SHA-256 does not match manifest");

    const versionProject = copyFixture();
    const manifestPath = projectPath(versionProject, manifestRelativePath);
    const manifest = readJson(manifestPath);
    manifest.project.sdk.version = "2.0.1";
    writeJson(manifestPath, manifest);
    expectCheckFailure(versionProject, "Invalid project.sdk");
  });

  it("requires exactly one real integration when enabled and zero when disabled", () => {
    const missingProject = copyFixture();
    stripIntegration(missingProject);
    expectCheckFailure(missingProject, "page equipment-ops-7c31fa must have exactly one PRD Annotator integration");

    const duplicateProject = copyFixture();
    const htmlPath = projectPath(duplicateProject, htmlRelativePath);
    const html = readFileSync(htmlPath, "utf8");
    const script = html.match(/<script\b[^>]*data-project-id[^>]*><\/script>/i)[0];
    writeFileSync(htmlPath, html.replace("</body>", `${script}\n</body>`));
    expectCheckFailure(duplicateProject, "page equipment-ops-7c31fa must have exactly one PRD Annotator integration");

    const disabledWithScript = copyFixture();
    const disabledManifestPath = projectPath(disabledWithScript, manifestRelativePath);
    const disabledManifest = readJson(disabledManifestPath);
    disabledManifest.pages[0].display.enabled = false;
    writeJson(disabledManifestPath, disabledManifest);
    expectCheckFailure(disabledWithScript, "disabled page equipment-ops-7c31fa must have zero PRD Annotator integrations");

    const disabledProject = copyFixture();
    const manifestPath = projectPath(disabledProject, manifestRelativePath);
    const manifest = readJson(manifestPath);
    manifest.pages[0].display.enabled = false;
    writeJson(manifestPath, manifest);
    stripIntegration(disabledProject);
    expect(runScript(checkScript, ["--project-root", disabledProject]).trim())
      .toBe("PRD Annotator gate passed: 1 pages, 1 annotations, 2 documents");
  });

  it("rejects integration identity mismatches and local paths outside the project", () => {
    const cases = [
      ["data-project-id", "other-project", "integration projectId does not match manifest"],
      ["data-page-id", "other-page", "integration pageId does not match manifest"],
      ["src", "../../../../outside.js", "src resolves outside project root"],
      ["data-view-src", "../../../../outside.js", "data-view-src resolves outside project root"],
      ["src", "https://example.test/sdk.js", "src must be a local relative URL"],
      ["data-view-src", "file:///outside.js", "data-view-src must be a local relative URL"]
    ];
    for (const [attribute, value, expected] of cases) {
      const projectRoot = copyFixture();
      replaceHtmlAttribute(projectRoot, attribute, value);
      expectCheckFailure(projectRoot, expected);
    }
  });

  it("rejects unsafe annotation and view ancestors", (context) => {
    for (const [directory, relativeTarget, expected] of [
      [".prd-annotator/data", annotationRelativePath, "Unsafe annotation file ancestor"],
      [".prd-annotator/view", viewRelativePath, "Unsafe view file ancestor"]
    ]) {
      const projectRoot = copyFixture();
      const outsideRoot = mkdtempSync(path.join(tmpdir(), "prd-gate-outside-"));
      temporaryDirectories.push(outsideRoot);
      mkdirSync(path.join(outsideRoot, "pages"), { recursive: true });
      writeFileSync(path.join(outsideRoot, `pages/${path.basename(relativeTarget)}`), readFileSync(projectPath(projectRoot, relativeTarget)));
      rmSync(projectPath(projectRoot, directory), { recursive: true, force: true });
      if (!makeLink(outsideRoot, projectPath(projectRoot, directory), "junction")) context.skip();
      expectCheckFailure(projectRoot, expected);
    }
  });

  it("requires every authorized annotation and view file to exist", () => {
    const annotationProject = copyFixture();
    rmSync(projectPath(annotationProject, annotationRelativePath), { force: true });
    expectCheckFailure(annotationProject, `Invalid annotation file: ${annotationRelativePath} does not exist`);

    const viewProject = copyFixture();
    rmSync(projectPath(viewProject, viewRelativePath), { force: true });
    expectCheckFailure(viewProject, `Invalid view file: ${viewRelativePath} does not exist`);
  });

  it("rejects annotation and view identity mismatches", () => {
    const annotationProject = copyFixture();
    const annotationPath = projectPath(annotationProject, annotationRelativePath);
    const annotation = readJson(annotationPath);
    annotation.projectId = "other-project";
    writeJson(annotationPath, annotation);
    expectCheckFailure(annotationProject, "annotation projectId does not match manifest");

    const viewProject = copyFixture();
    const view = parseView(viewProject);
    view.page.id = "other-page";
    writeView(viewProject, view);
    expectCheckFailure(viewProject, "view page.id does not match manifest");

    const routeProject = copyFixture();
    const routePath = projectPath(routeProject, annotationRelativePath);
    const routeDocument = readJson(routePath);
    routeDocument.page.route = "/unrelated";
    writeJson(routePath, routeDocument);
    expectCheckFailure(routeProject, "annotation page.route does not match manifest HTML path");
  });

  it("rejects a stale persisted annotation fingerprint and incomplete view document inventory", () => {
    const fingerprintProject = copyFixture();
    const view = parseView(fingerprintProject);
    view.persistedAnnotationFingerprint = "fnv1a32:00000000";
    writeView(fingerprintProject, view);
    expectCheckFailure(fingerprintProject, "persisted annotation fingerprint is stale for equipment-ops-7c31fa");

    const missingViewDocumentProject = copyFixture();
    const incompleteView = parseView(missingViewDocumentProject);
    incompleteView.documents.shift();
    writeView(missingViewDocumentProject, incompleteView);
    expectCheckFailure(missingViewDocumentProject, "view document inventory is incomplete for equipment-ops-7c31fa");

    const duplicateViewDocumentProject = copyFixture();
    const duplicateView = parseView(duplicateViewDocumentProject);
    duplicateView.documents.push({ ...duplicateView.documents[0] });
    writeView(duplicateViewDocumentProject, duplicateView);
    expectCheckFailure(duplicateViewDocumentProject, "duplicate view document id doc-page-primary");
  });

  it("rejects stale view document fingerprints and statuses", () => {
    const sourceProject = copyFixture();
    appendFileSync(projectPath(sourceProject, sourcePrdRelativePath), "\nchanged\n");
    expectCheckFailure(sourceProject, "view fingerprint is stale for doc-page-primary");

    const statusProject = copyFixture();
    const view = parseView(statusProject);
    view.documents[0].previewStatus = "stale";
    writeView(statusProject, view);
    expectCheckFailure(statusProject, "view status is stale for doc-page-primary");
  });

  it("requires complete source-document inventory exactly once", () => {
    const missingProject = copyFixture();
    mkdirSync(projectPath(missingProject, "requirements"));
    writeFileSync(projectPath(missingProject, "requirements/new.md"), "# New requirement\n");
    expectCheckFailure(missingProject, "document inventory is incomplete: requirements/new.md");

    const staleManifestProject = copyFixture();
    const manifestPath = projectPath(staleManifestProject, manifestRelativePath);
    const manifest = readJson(manifestPath);
    manifest.documents[0].fingerprint = `sha256:${"0".repeat(64)}`;
    writeJson(manifestPath, manifest);
    expectCheckFailure(staleManifestProject, "document fingerprint is stale for doc-total-primary");
  });

  it("retains missing documents only when explicitly marked missing", () => {
    const projectRoot = copyFixture();
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const manifest = readJson(manifestPath);
    manifest.documents.push({
      id: "doc-explicit-missing",
      title: "Missing legacy source",
      path: "legacy/missing.pdf",
      format: "pdf",
      kind: "requirement",
      pageIds: [],
      associationSource: "manual",
      evidence: ["retained historical source"],
      fingerprint: `sha256:${"f".repeat(64)}`,
      previewStatus: "missing",
      missing: true
    });
    writeJson(manifestPath, manifest);
    expect(runScript(checkScript, ["--project-root", projectRoot]).trim())
      .toBe("PRD Annotator gate passed: 1 pages, 1 annotations, 3 documents");

    const implicitProject = copyFixture();
    const implicitManifestPath = projectPath(implicitProject, manifestRelativePath);
    const implicitManifest = readJson(implicitManifestPath);
    implicitManifest.documents.push({ ...manifest.documents.at(-1), missing: false, previewStatus: "unavailable" });
    writeJson(implicitManifestPath, implicitManifest);
    expectCheckFailure(implicitProject, "missing document must be explicitly marked missing: legacy/missing.pdf");
  });

  it("rejects a symlinked source that is recorded as missing", (context) => {
    const projectRoot = copyFixture();
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "prd-gate-missing-link-"));
    temporaryDirectories.push(outsideRoot);
    writeFileSync(path.join(outsideRoot, "sentinel.pdf"), "outside bytes");
    mkdirSync(projectPath(projectRoot, "legacy"));
    if (!makeLink(path.join(outsideRoot, "sentinel.pdf"), projectPath(projectRoot, "legacy/missing.pdf"), "file")) {
      context.skip();
    }
    const manifestPath = projectPath(projectRoot, manifestRelativePath);
    const manifest = readJson(manifestPath);
    manifest.documents.push({
      id: "doc-explicit-missing",
      title: "Missing legacy source",
      path: "legacy/missing.pdf",
      format: "pdf",
      kind: "requirement",
      pageIds: [],
      associationSource: "manual",
      evidence: ["retained historical source"],
      fingerprint: `sha256:${"f".repeat(64)}`,
      previewStatus: "missing",
      missing: true
    });
    writeJson(manifestPath, manifest);

    expectCheckFailure(projectRoot, "Unsafe document source doc-explicit-missing target");
  });

  it("checks managed PRD bytes and safe paths when managed contracts are present", () => {
    const staleProject = copyFixture();
    const manifestPath = projectPath(staleProject, manifestRelativePath);
    const annotationPath = projectPath(staleProject, annotationRelativePath);
    const manifest = readJson(manifestPath);
    const annotation = readJson(annotationPath);
    manifest.pages[0].managedPrdFile = sourcePrdRelativePath;
    annotation.managedPrd = {
      title: "Equipment Operations",
      sections: [{ id: "goal", title: "Goal", blocks: ["Keep device operations safe."] }]
    };
    writeJson(manifestPath, manifest);
    writeJson(annotationPath, annotation);
    const view = parseView(staleProject);
    view.document.managedPrd = annotation.managedPrd;
    writeView(staleProject, view);
    expectCheckFailure(staleProject, "managed PRD bytes are stale for equipment-ops-7c31fa");

    const unsafeProject = copyFixture();
    const unsafeManifestPath = projectPath(unsafeProject, manifestRelativePath);
    const unsafeManifest = readJson(unsafeManifestPath);
    unsafeManifest.pages[0].managedPrdFile = "../outside.md";
    writeJson(unsafeManifestPath, unsafeManifest);
    expectCheckFailure(unsafeProject, "Invalid page.managedPrdFile");
  });

  it("never writes while reporting a gate failure", () => {
    const projectRoot = copyFixture();
    const annotationPath = projectPath(projectRoot, annotationRelativePath);
    const permanent = readJson(annotationPath);
    permanent.annotations[0].updatedAt = "invalid";
    writeJson(annotationPath, permanent);
    const before = snapshotFiles(projectRoot);

    expectCheckFailure(projectRoot, "annotation A001.updatedAt must be an ISO timestamp");

    expect(snapshotFiles(projectRoot)).toEqual(before);
  });

  it("keeps check-prd as delegation and exposes no destructive annotation workflow", () => {
    const compatibilitySource = readFileSync(compatibilityScript, "utf8");
    const gateSource = readFileSync(checkScript, "utf8");
    const mergeSource = readFileSync(path.join(skillRoot, "scripts/merge-annotations.mjs"), "utf8");

    expect(compatibilitySource).toContain("./check-project.mjs");
    expect(compatibilitySource).not.toContain("function assertAnnotation");
    expect(`${compatibilitySource}\n${gateSource}\n${mergeSource}`).not.toMatch(
      /\b(?:unlink|removeItem|clearAll|resetData|purge)\b/
    );
  });
});
