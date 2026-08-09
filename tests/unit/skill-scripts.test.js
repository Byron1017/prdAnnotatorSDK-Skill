import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintValue } from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import { mergeSnapshot } from "../../prd-annotator-skill/scripts/merge-annotations.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repositoryRoot, "tests/fixtures/project");
const skillRoot = path.join(repositoryRoot, "prd-annotator-skill");
const mergeScript = path.join(skillRoot, "scripts/merge-annotations.mjs");
const annotationRelativePath = ".prd-annotator/data/pages/equipment-ops-7c31fa.json";
const temporaryDirectories = [];
const linkPermissionErrors = new Set(["EACCES", "EPERM", "ENOTSUP"]);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function copyFixture() {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "prd-annotator-test-"));
  temporaryDirectories.push(temporaryRoot);
  const projectRoot = path.join(temporaryRoot, "project");
  cpSync(fixtureRoot, projectRoot, { recursive: true });
  return projectRoot;
}

function runScript(script, args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function expectCliFailure(script, args, expectedMessage) {
  let failure;
  try {
    runScript(script, args);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeTruthy();
  expect(`${failure.stdout || ""}${failure.stderr || ""}`).toContain(expectedMessage);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function annotationPath(projectRoot) {
  return path.join(projectRoot, ...annotationRelativePath.split("/"));
}

function annotation(id, updatedAt = "2026-08-09T02:00:00.000Z", overrides = {}) {
  return {
    id,
    title: `title-${id}`,
    description: `description-${id}`,
    type: "requirement",
    prdContent: `prd-${id}`,
    acceptanceCriteria: "",
    dataFields: "",
    apiPath: "",
    edgeCases: "",
    status: "open",
    createdAt: updatedAt,
    updatedAt,
    target: {
      cssPath: "main",
      xpath: "/html/body/main",
      textQuote: "Equipment list",
      rect: { x: 0, y: 0, width: 100, height: 40 }
    },
    prd: {
      linkedDocuments: [],
      linkedSections: [],
      impactScope: "page",
      summary: ""
    },
    ...overrides
  };
}

function rawSnapshot(annotations, overrides = {}) {
  return {
    schemaVersion: 2,
    projectId: "fixture-project-a13f92",
    document: {
      schemaVersion: 2,
      projectId: "fixture-project-a13f92",
      page: {
        id: "equipment-ops-7c31fa",
        title: "Equipment Operations",
        htmlPath: "prototype/index.html",
        route: "/prototype/index.html"
      },
      annotations,
      managedPrd: null
    },
    ...overrides
  };
}

function promptPayload(annotations, overrides = {}) {
  const snapshot = rawSnapshot(annotations);
  return {
    annotationPath: annotationRelativePath,
    document: snapshot.document,
    fingerprint: fingerprintValue(annotations),
    htmlPath: "prototype/index.html",
    manifestPath: ".prd-annotator/manifest.json",
    pageId: "equipment-ops-7c31fa",
    projectId: "fixture-project-a13f92",
    viewPath: ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
    ...overrides
  };
}

function writeSnapshot(projectRoot, value) {
  const snapshotPath = path.join(path.dirname(projectRoot), `snapshot-${Math.random()}.json`);
  writeJson(snapshotPath, value);
  return snapshotPath;
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

describe("permanent annotation merge", () => {
  it("merges an empty snapshot without reducing permanent ids", async () => {
    const projectRoot = copyFixture();

    const merged = await mergeSnapshot({ projectRoot, snapshot: rawSnapshot([]) });

    expect(merged.annotations.map((item) => item.id)).toEqual(["A001"]);
    expect(readJson(annotationPath(projectRoot)).annotations.map((item) => item.id))
      .toEqual(["A001"]);
  });

  it("adds browser-only ids while preserving permanent-only ids and stale targets", async () => {
    const projectRoot = copyFixture();
    const incoming = annotation("A002", "2026-08-09T02:00:00.000Z", {
      target: {
        cssPath: ".removed-control",
        xpath: "/html/body/main/button[99]",
        textQuote: "Removed control",
        rect: { x: 20, y: 30, width: 40, height: 50 }
      }
    });

    const merged = await mergeSnapshot({ projectRoot, snapshot: rawSnapshot([incoming]) });

    expect(merged.annotations.map((item) => item.id)).toEqual(["A001", "A002"]);
    expect(merged.annotations[1].target).toEqual(incoming.target);
  });

  it("updates an id only for a strictly newer timestamp", async () => {
    const projectRoot = copyFixture();
    const older = annotation("A001", "2026-08-08T00:30:00.000Z", { title: "older" });
    const newer = annotation("A001", "2026-08-09T03:00:00.000Z", { title: "newer" });

    await mergeSnapshot({ projectRoot, snapshot: rawSnapshot([older]) });
    expect(readJson(annotationPath(projectRoot)).annotations[0].title).toBe("Batch disable");
    await mergeSnapshot({ projectRoot, snapshot: rawSnapshot([newer]) });
    expect(readJson(annotationPath(projectRoot)).annotations[0].title).toBe("newer");
  });

  it("serializes concurrent merges so neither writer can lose the other new id", async () => {
    const projectRoot = copyFixture();

    await Promise.all([
      mergeSnapshot({ projectRoot, snapshot: rawSnapshot([annotation("A002")]) }),
      mergeSnapshot({ projectRoot, snapshot: rawSnapshot([annotation("A003")]) })
    ]);

    expect(readJson(annotationPath(projectRoot)).annotations.map((item) => item.id).sort())
      .toEqual(["A001", "A002", "A003"]);

    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A001", "2026-08-08T01:00:00.000Z", { title: "conflict" })])
    })).rejects.toThrow("conflicting annotation A001 has the same updatedAt");
    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A004")])
    })).resolves.toMatchObject({ annotations: expect.arrayContaining([expect.objectContaining({ id: "A004" })]) });
  });

  it("rejects duplicate or equal-time conflicting snapshot ids without writing", async () => {
    const projectRoot = copyFixture();
    const before = readFileSync(annotationPath(projectRoot));
    const duplicate = [annotation("A002"), annotation("A002", "2026-08-09T03:00:00.000Z")];

    await expect(mergeSnapshot({ projectRoot, snapshot: rawSnapshot(duplicate) }))
      .rejects.toThrow("duplicate annotation id A002");
    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A001", "2026-08-08T01:00:00.000Z", { title: "conflict" })])
    })).rejects.toThrow("conflicting annotation A001 has the same updatedAt");
    expect(readFileSync(annotationPath(projectRoot))).toEqual(before);
  });

  it("rejects project, page, and prompt path identity mismatches before writing", async () => {
    const mutations = [
      [rawSnapshot([], { projectId: "other-project" }), "snapshot projectId does not match manifest"],
      [rawSnapshot([], { document: { ...rawSnapshot([]).document, projectId: "other-project" } }), "document projectId does not match manifest"],
      [rawSnapshot([], { document: { ...rawSnapshot([]).document, page: { ...rawSnapshot([]).document.page, id: "other-page" } } }), "snapshot page.id is not authorized by manifest"],
      [promptPayload([], { pageId: "other-page" }), "payload pageId does not match document page.id"],
      [promptPayload([], { annotationPath: ".prd-annotator/data/pages/other.json" }), "payload annotationPath does not match manifest"],
      [promptPayload([], { viewPath: ".prd-annotator/view/pages/other.js" }), "payload viewPath does not match manifest"],
      [promptPayload([], { htmlPath: "prototype/other.html" }), "payload htmlPath does not match manifest"],
      [promptPayload([], { fingerprint: "fnv1a32:00000000" }), "payload fingerprint does not match annotations"],
      [{ ...rawSnapshot([]), schemaVersion: 1 }, "snapshot schemaVersion does not match document schemaVersion"]
    ];

    for (const [snapshot, message] of mutations) {
      const projectRoot = copyFixture();
      const before = readFileSync(annotationPath(projectRoot));
      await expect(mergeSnapshot({ projectRoot, snapshot })).rejects.toThrow(message);
      expect(readFileSync(annotationPath(projectRoot))).toEqual(before);
    }
  });

  it("normalizes a legacy v1 snapshot but requires complete fields from native v2", async () => {
    const projectRoot = copyFixture();
    const legacy = {
      schemaVersion: 1,
      projectKey: "fixture-project-a13f92",
      document: {
        schemaVersion: 1,
        page: { id: "equipment-ops-7c31fa", title: "Equipment Operations", route: "/prototype/index.html" },
        annotations: [{
          id: "A002",
          comment: "Legacy requirement",
          status: "open",
          createdAt: "2026-08-09T03:00:00.000Z",
          updatedAt: "2026-08-09T03:00:00.000Z",
          target: { cssPath: "main", xpath: "/html/body/main", textQuote: "Equipment list", rect: { x: 0, y: 0, width: 1, height: 1 } },
          prd: { linkedSections: [], impactScope: "page", summary: "" }
        }]
      }
    };

    const merged = await mergeSnapshot({ projectRoot, snapshot: legacy });
    expect(merged.annotations[1]).toMatchObject({
      id: "A002",
      title: "Legacy requirement",
      description: "Legacy requirement",
      type: "requirement",
      prdContent: "Legacy requirement"
    });

    const invalidV2 = rawSnapshot([annotation("A003", undefined, { prdContent: "" })]);
    await expect(mergeSnapshot({ projectRoot, snapshot: invalidV2 }))
      .rejects.toThrow("annotation A003.prdContent must be a non-empty string");
  });

  it("supports raw snapshot and extracted prompt-payload JSON files, never prose", () => {
    const rawProject = copyFixture();
    const rawPath = writeSnapshot(rawProject, rawSnapshot([annotation("A002")]));
    expect(runScript(mergeScript, ["--project-root", rawProject, "--snapshot", rawPath]))
      .toContain("Merged equipment-ops-7c31fa");

    const payloadProject = copyFixture();
    const payloadPath = writeSnapshot(payloadProject, promptPayload([annotation("A002")]));
    expect(runScript(mergeScript, ["--project-root", payloadProject, "--snapshot", payloadPath]))
      .toContain("Merged equipment-ops-7c31fa");

    const proseProject = copyFixture();
    const prosePath = path.join(path.dirname(proseProject), "prompt.txt");
    writeFileSync(prosePath, `Instructions\n---PRD_ANNOTATOR_PAYLOAD_START---\n${JSON.stringify(promptPayload([]))}\n---PRD_ANNOTATOR_PAYLOAD_END---\n`);
    const before = readFileSync(annotationPath(proseProject));
    expectCliFailure(mergeScript, ["--project-root", proseProject, "--snapshot", prosePath], "Invalid snapshot JSON");
    expect(readFileSync(annotationPath(proseProject))).toEqual(before);
  });

  it("validates the manifest before resolving a CLI annotation path", () => {
    const projectRoot = copyFixture();
    const manifestPath = path.join(projectRoot, ".prd-annotator/manifest.json");
    const manifest = readJson(manifestPath);
    manifest.project.sdk.version = "invalid";
    manifest.pages[0].annotationFile = "prototype/index.html";
    writeJson(manifestPath, manifest);
    const snapshotPath = writeSnapshot(projectRoot, rawSnapshot([]));

    expectCliFailure(
      mergeScript,
      ["--project-root", projectRoot, "--snapshot", snapshotPath],
      "Invalid project.sdk"
    );
  });

  it("rejects a junctioned annotation ancestor without touching outside data", async (context) => {
    const projectRoot = copyFixture();
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "prd-annotator-outside-"));
    temporaryDirectories.push(outsideRoot);
    mkdirSync(path.join(outsideRoot, "pages"), { recursive: true });
    const outsideFile = path.join(outsideRoot, "pages/equipment-ops-7c31fa.json");
    writeFileSync(outsideFile, readFileSync(annotationPath(projectRoot)));
    rmSync(path.join(projectRoot, ".prd-annotator/data"), { recursive: true, force: true });
    if (!makeLink(outsideRoot, path.join(projectRoot, ".prd-annotator/data"), "junction")) context.skip();
    const before = readFileSync(outsideFile);

    await expect(mergeSnapshot({ projectRoot, snapshot: rawSnapshot([annotation("A002")]) }))
      .rejects.toThrow(/Unsafe annotation file ancestor/);
    expect(readFileSync(outsideFile)).toEqual(before);
  });
});
