import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject } from "../../prd-annotator-skill/scripts/check-project.mjs";
import {
  annotationFingerprintInput,
  fingerprintValue
} from "../../prd-annotator-skill/scripts/lib/schema.mjs";
import { mergeSnapshot } from "../../prd-annotator-skill/scripts/merge-annotations.mjs";
import { refreshProject } from "../../prd-annotator-skill/scripts/refresh-project.mjs";

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

function runScriptProcess(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
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

function mergeArtifacts(projectRoot) {
  const directory = path.dirname(annotationPath(projectRoot));
  return readdirSync(directory).filter((name) => name.includes(".merge-") || name.endsWith(".merge.lock"));
}

function transactionArtifacts(projectRoot) {
  return readdirSync(projectRoot).filter((name) => name.startsWith(".prd-annotator-transaction-"));
}

function snapshotProject(projectRoot) {
  const result = {};
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        result[`${relativePath}/`] = "directory";
        visit(absolutePath);
      } else if (entry.isFile()) {
        result[relativePath] = readFileSync(absolutePath);
      }
    }
  }
  visit(projectRoot);
  return result;
}

function annotation(id, updatedAt = "2026-08-09T02:00:00.000Z", overrides = {}) {
  return {
    id,
    title: `title-${id}`,
    description: `description-${id}`,
    type: "requirement",
    prdContent: `prd-${id}`,
    note: "",
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
  const { document: documentOverrides = {}, ...envelopeOverrides } = overrides;
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
      deletedAnnotations: [],
      ...documentOverrides,
      managedPrd: null
    },
    ...envelopeOverrides
  };
}

function promptPayload(annotations, overrides = {}) {
  const { document: documentOverrides = {}, ...payloadOverrides } = overrides;
  const snapshot = rawSnapshot(annotations, { document: documentOverrides });
  return {
    annotationPath: annotationRelativePath,
    document: snapshot.document,
    fingerprint: fingerprintValue(annotationFingerprintInput(snapshot.document)),
    htmlPath: "prototype/index.html",
    manifestPath: ".prd-annotator/manifest.json",
    pageId: "equipment-ops-7c31fa",
    projectId: "fixture-project-a13f92",
    viewPath: ".prd-annotator/view/pages/equipment-ops-7c31fa.js",
    ...payloadOverrides
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

  it("deletes permanent ids only when the snapshot contains explicit tombstones", async () => {
    const projectRoot = copyFixture();
    const snapshot = rawSnapshot([], {
      document: {
        deletedAnnotations: [
          { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
        ]
      }
    });

    const merged = await mergeSnapshot({ projectRoot, snapshot });

    expect(merged.annotations).toEqual([]);
    expect(merged.deletedAnnotations).toEqual(snapshot.document.deletedAnnotations);
  });

  it("does not resurrect a tombstoned id from a later stale snapshot", async () => {
    const projectRoot = copyFixture();
    await mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([], {
        document: {
          deletedAnnotations: [
            { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
          ]
        }
      })
    });

    const merged = await mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([
        annotation("A001", "2026-08-11T10:00:00.000Z")
      ])
    });

    expect(merged.annotations).toEqual([]);
    expect(merged.deletedAnnotations.map(({ id }) => id)).toEqual(["A001"]);
  });

  it("validates prompt fingerprints over active annotations and tombstones", async () => {
    const projectRoot = copyFixture();
    const document = {
      deletedAnnotations: [
        { id: "A001", deletedAt: "2026-08-11T09:10:00.000Z" }
      ]
    };

    await expect(mergeSnapshot({
      projectRoot,
      snapshot: promptPayload([], { document })
    })).resolves.toMatchObject({ annotations: [] });

    const staleProject = copyFixture();
    await expect(mergeSnapshot({
      projectRoot: staleProject,
      snapshot: promptPayload([], {
        document,
        fingerprint: fingerprintValue([])
      })
    })).rejects.toThrow("payload fingerprint does not match annotations");
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

  it("merges note while retaining historical optional and unknown fields", async () => {
    const projectRoot = copyFixture();
    const permanent = readJson(annotationPath(projectRoot));
    permanent.annotations[0].legacyExtension = { source: "v2.2" };
    writeJson(annotationPath(projectRoot), permanent);

    const incoming = {
      ...permanent.annotations[0],
      note: "Updated note",
      updatedAt: "2026-08-11T10:00:00.000Z"
    };
    const merged = await mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([incoming])
    });

    expect(merged.annotations[0]).toMatchObject({
      note: "Updated note",
      acceptanceCriteria: permanent.annotations[0].acceptanceCriteria,
      dataFields: permanent.annotations[0].dataFields,
      apiPath: permanent.annotations[0].apiPath,
      edgeCases: permanent.annotations[0].edgeCases,
      legacyExtension: { source: "v2.2" }
    });
  });

  it("retains permanent compatibility fields for a newer partial edit", async () => {
    const projectRoot = copyFixture();
    const permanent = readJson(annotationPath(projectRoot));
    permanent.annotations[0].note = "Historical note";
    permanent.annotations[0].legacyExtension = { source: "v2.2" };
    writeJson(annotationPath(projectRoot), permanent);

    const {
      note,
      acceptanceCriteria,
      dataFields,
      apiPath,
      edgeCases,
      legacyExtension,
      ...incoming
    } = permanent.annotations[0];
    incoming.title = "Newer partial edit";
    incoming.updatedAt = "2026-08-11T10:00:00.000Z";
    const merged = await mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([incoming])
    });

    expect(merged.annotations[0]).toMatchObject({
      title: "Newer partial edit",
      note,
      acceptanceCriteria,
      dataFields,
      apiPath,
      edgeCases,
      legacyExtension
    });
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

  it("serializes independent CLI merge processes without losing either writer", async () => {
    const projectRoot = copyFixture();
    const firstPath = writeSnapshot(projectRoot, rawSnapshot([annotation("A002")]));
    const secondPath = writeSnapshot(projectRoot, rawSnapshot([annotation("A003")]));

    const [first, second] = await Promise.all([
      runScriptProcess(mergeScript, ["--project-root", projectRoot, "--snapshot", firstPath]),
      runScriptProcess(mergeScript, ["--project-root", projectRoot, "--snapshot", secondPath])
    ]);

    expect([first.status, second.status]).toEqual([0, 0]);
    expect([first.stderr, second.stderr]).toEqual(["", ""]);
    expect([first.stdout, second.stdout].sort()).toEqual([
      "Merged equipment-ops-7c31fa: 1 incoming, 0 deletions, 2 active, 0 tombstones\n",
      "Merged equipment-ops-7c31fa: 1 incoming, 0 deletions, 3 active, 0 tombstones\n"
    ]);
    expect(readJson(annotationPath(projectRoot)).annotations.map((item) => item.id).sort())
      .toEqual(["A001", "A002", "A003"]);
    expect(mergeArtifacts(projectRoot)).toEqual([]);
  });

  it("removes only its staging file and leaves the project unchanged when stage write or rename fails", async () => {
    for (const [hook, message] of [
      ["beforeStageWrite", "injected staging-write failure"],
      ["beforeRename", "injected rename failure"]
    ]) {
      const projectRoot = copyFixture();
      const sentinel = path.join(path.dirname(annotationPath(projectRoot)), ".unrelated.merge-user.tmp");
      const unrelatedLock = path.join(path.dirname(annotationPath(projectRoot)), ".unrelated.merge.lock");
      writeFileSync(sentinel, "user-owned bytes\n");
      mkdirSync(unrelatedLock);
      const before = snapshotProject(projectRoot);

      await expect(mergeSnapshot({
        projectRoot,
        snapshot: rawSnapshot([annotation("A002")]),
        transactionHooks: {
          [hook]: () => { throw new Error(message); }
        }
      })).rejects.toThrow(message);

      expect(snapshotProject(projectRoot)).toEqual(before);
      expect(readFileSync(sentinel, "utf8")).toBe("user-owned bytes\n");
      expect(readdirSync(unrelatedLock)).toEqual([]);
    }
  });

  it("rejects before-rename drift that adds a permanent ID and preserves every external byte", async () => {
    const projectRoot = copyFixture();
    const targetPath = annotationPath(projectRoot);
    const externalDocument = readJson(targetPath);
    externalDocument.annotations.push(annotation("A003", "2026-08-09T03:00:00.000Z"));
    const externalBytes = Buffer.from(`${JSON.stringify(externalDocument, null, 2)}\n`, "utf8");
    const before = snapshotProject(projectRoot);

    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A002")]),
      transactionHooks: {
        beforeRename() {
          writeFileSync(targetPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Concurrent modification detected: ${annotationRelativePath}`);

    const after = snapshotProject(projectRoot);
    expect(readFileSync(targetPath)).toEqual(externalBytes);
    expect(readJson(targetPath).annotations.map(({ id }) => id)).toEqual(["A001", "A003"]);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const [relativePath, bytes] of Object.entries(before)) {
      if (relativePath !== annotationRelativePath) expect(after[relativePath]).toEqual(bytes);
    }
    expect(mergeArtifacts(projectRoot)).toEqual([]);
    expect(transactionArtifacts(projectRoot)).toEqual([]);
  });

  it("rejects exact-byte drift with the same permanent ID set and preserves external formatting/content", async () => {
    const projectRoot = copyFixture();
    const targetPath = annotationPath(projectRoot);
    const externalDocument = readJson(targetPath);
    externalDocument.annotations[0].title = "external title retained";
    const externalBytes = Buffer.from(`${JSON.stringify(externalDocument)}\r\n`, "utf8");
    const before = snapshotProject(projectRoot);

    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A002")]),
      transactionHooks: {
        beforeRename() {
          writeFileSync(targetPath, externalBytes);
        }
      }
    })).rejects.toThrow(`Concurrent modification detected: ${annotationRelativePath}`);

    const after = snapshotProject(projectRoot);
    expect(readFileSync(targetPath)).toEqual(externalBytes);
    expect(readJson(targetPath).annotations).toHaveLength(1);
    expect(readJson(targetPath).annotations[0]).toMatchObject({ id: "A001", title: "external title retained" });
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const [relativePath, bytes] of Object.entries(before)) {
      if (relativePath !== annotationRelativePath) expect(after[relativePath]).toEqual(bytes);
    }
    expect(mergeArtifacts(projectRoot)).toEqual([]);
    expect(transactionArtifacts(projectRoot)).toEqual([]);
  });

  it("keeps a normal merge refreshable and passes the complete project gate", async () => {
    const projectRoot = copyFixture();

    const merged = await mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A002")])
    });
    await refreshProject({ projectRoot, now: () => new Date("2026-08-11T00:00:00.000Z") });

    expect(merged.annotations.map(({ id }) => id)).toEqual(["A001", "A002"]);
    await expect(checkProject({ projectRoot })).resolves.toMatchObject({ pages: 1, annotations: 2, documents: 2 });
  });

  it("retries lock release deterministically and resolves truthfully after a committed write", async () => {
    const retryProject = copyFixture();
    const attempts = [];
    await expect(mergeSnapshot({
      projectRoot: retryProject,
      snapshot: rawSnapshot([annotation("A002")]),
      transactionHooks: {
        beforeLockRelease: ({ attempt }) => {
          attempts.push(attempt);
          if (attempt < 3) throw new Error("injected transient lock-release failure");
        }
      }
    })).resolves.toMatchObject({ annotations: expect.arrayContaining([expect.objectContaining({ id: "A002" })]) });
    expect(attempts).toEqual([1, 2, 3]);
    expect(mergeArtifacts(retryProject)).toEqual([]);

    const warningProject = copyFixture();
    const warnings = [];
    const lockPath = `${annotationPath(warningProject)}.merge.lock`;
    await expect(mergeSnapshot({
      projectRoot: warningProject,
      snapshot: rawSnapshot([annotation("A002")]),
      onWarning: (warning) => warnings.push(warning),
      transactionHooks: {
        beforeLockRelease: () => { throw new Error("injected permanent lock-release failure"); }
      }
    })).resolves.toMatchObject({ annotations: expect.arrayContaining([expect.objectContaining({ id: "A002" })]) });
    expect(readJson(annotationPath(warningProject)).annotations.map((item) => item.id)).toContain("A002");
    expect(warnings).toEqual([
      `Failed to release annotation merge lock after 3 attempts: ${lockPath}: injected permanent lock-release failure`
    ]);
    expect(existsSync(lockPath)).toBe(true);
  });

  it("times out on a stale lock without writing and reports the absolute lock path", async () => {
    const projectRoot = copyFixture();
    const before = readFileSync(annotationPath(projectRoot));
    const lockPath = `${annotationPath(projectRoot)}.merge.lock`;
    mkdirSync(lockPath);

    await expect(mergeSnapshot({
      projectRoot,
      snapshot: rawSnapshot([annotation("A002")]),
      lockOptions: { timeoutMs: 20, retryMs: 1 }
    })).rejects.toThrow(`Timed out waiting for annotation merge lock: ${lockPath}`);

    expect(readFileSync(annotationPath(projectRoot))).toEqual(before);
    expect(readdirSync(lockPath)).toEqual([]);
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

  it("requires native v2 raw and prompt envelopes to use only a non-empty projectId before locking", async () => {
    const cases = [
      { snapshot: { ...rawSnapshot([]), projectId: "", projectKey: "fixture-project-a13f92" } },
      { snapshot: { ...rawSnapshot([]), projectId: undefined, projectKey: "fixture-project-a13f92" } },
      { snapshot: { ...rawSnapshot([]), projectKey: "fixture-project-a13f92" } },
      { snapshot: promptPayload([], { projectId: "", projectKey: "fixture-project-a13f92" }) },
      { snapshot: promptPayload([], { projectKey: "fixture-project-a13f92" }) }
    ];

    for (const { snapshot } of cases) {
      const projectRoot = copyFixture();
      const before = readFileSync(annotationPath(projectRoot));
      await expect(mergeSnapshot({ projectRoot, snapshot }))
        .rejects.toThrow("schema-v2 snapshot must use a non-empty projectId without projectKey");
      expect(readFileSync(annotationPath(projectRoot))).toEqual(before);
      expect(mergeArtifacts(projectRoot)).toEqual([]);
    }
  });

  it("validates transaction hooks before reading or writing project data", async () => {
    for (const transactionHooks of [null, [], { beforeRename: true }, { unknownHook: () => {} }]) {
      const projectRoot = copyFixture();
      const before = snapshotProject(projectRoot);
      await expect(mergeSnapshot({ projectRoot, snapshot: rawSnapshot([]), transactionHooks }))
        .rejects.toThrow("Invalid transactionHooks");
      expect(snapshotProject(projectRoot)).toEqual(before);
    }
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

  it("prints exact CLI stdout and stderr for success and validation failure", async () => {
    const successProject = copyFixture();
    const successPath = writeSnapshot(successProject, rawSnapshot([annotation("A002")]));
    await expect(runScriptProcess(
      mergeScript,
      ["--project-root", successProject, "--snapshot", successPath]
    )).resolves.toEqual({
      status: 0,
      stdout: "Merged equipment-ops-7c31fa: 1 incoming, 0 deletions, 2 active, 0 tombstones\n",
      stderr: ""
    });

    const failureProject = copyFixture();
    const failurePath = writeSnapshot(failureProject, rawSnapshot([], { projectId: "other-project" }));
    await expect(runScriptProcess(
      mergeScript,
      ["--project-root", failureProject, "--snapshot", failurePath]
    )).resolves.toEqual({
      status: 1,
      stdout: "",
      stderr: "snapshot projectId does not match manifest\n"
    });
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

  it("refreshes and gates legacy v2 page JSON without a tombstone field", async () => {
    const projectRoot = copyFixture();
    const permanent = readJson(annotationPath(projectRoot));
    delete permanent.deletedAnnotations;
    writeJson(annotationPath(projectRoot), permanent);
    await refreshProject({ projectRoot, now: new Date("2026-08-11T09:20:00.000Z") });
    await expect(checkProject({ projectRoot }))
      .resolves.toMatchObject({ pages: 1, annotations: 1 });
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

describe("global Skill contract", () => {
  it("separates route refresh and annotation sync from explicit document work", () => {
    const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const installationSource = readFileSync(path.join(skillRoot, "references/installation.md"), "utf8");
    const workflowSource = readFileSync(path.join(skillRoot, "references/prd-workflow.md"), "utf8");
    const combinedRouteSource = `${skillSource}\n${installationSource}`;

    expect(skillSource).toContain("annotation synchronization alone must never create or edit a document");
    expect(workflowSource).toContain("Field specification");
    expect(workflowSource).toContain("API document");
    expect(workflowSource).toContain("existing directory, naming, format, and section structure");
    expect(workflowSource).toContain("route refresh and View refresh do not authorize document writes");
    expect(combinedRouteSource).toContain("Vue Router");
    expect(combinedRouteSource).toContain("declared `:parameters`");
    expect(combinedRouteSource).toContain("set-routes.mjs");
    expect(combinedRouteSource).toContain("--confirm-route-write");
  });

  it("separates explicit annotation deletion from every PRD or related-document edit", () => {
    const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const schemaSource = readFileSync(path.join(skillRoot, "references/data-schema.md"), "utf8");
    const workflowSource = readFileSync(path.join(skillRoot, "references/prd-workflow.md"), "utf8");

    expect(skillSource).toContain("browser tombstone as explicit authorization");
    expect(skillSource).toContain("Never infer deletion from omission");
    expect(skillSource).toContain("Annotation edit or deletion does not authorize editing any PRD or related document");
    expect(schemaSource).toContain("deletedAnnotations");
    expect(schemaSource).toContain("same-page tombstone");
    expect(schemaSource).toContain("fingerprint");
    expect(workflowSource).toContain("persists tombstones");
    expect(workflowSource).toContain("never invents tombstones");
    expect(workflowSource).toContain("separate user intent");
  });

  it("documents the consent-gated global workflow without legacy project assumptions", () => {
    const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const workflowSource = readFileSync(path.join(skillRoot, "references/prd-workflow.md"), "utf8");
    const requiredContracts = [
      "explicit user authorization",
      ".prd-annotator/manifest.json",
      "latest formal GitHub Release",
      "--confirm-install",
      "--confirm-upgrade",
      "--confirm-remove",
      "data-view-src",
      "复制同步提示词",
      "complete annotation payload",
      "copying is not synchronization",
      "do not choose or merge ambiguous PRDs",
      "resolve scripts relative to this Skill directory"
    ];

    for (const contract of requiredContracts) {
      expect(skillSource).toContain(contract);
    }
    expect(skillSource).not.toContain("Locate `doc/prd/manifest.json`");
    expect(skillSource).not.toContain("Do not ask the human to copy");
    expect(workflowSource).toContain("schema-v2 manifest file is absent");
    expect(workflowSource).toContain("Preserve a corrupt manifest and report validation failure");
    expect(workflowSource).not.toContain("without a valid schema-v2 manifest");
  });

  it("loads document writing references only for explicit document work", () => {
    const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const workflow = readFileSync(
      path.join(skillRoot, "references/document-writing.md"),
      "utf8"
    );
    const style = readFileSync(
      path.join(skillRoot, "references/markdown-style.md"),
      "utf8"
    );

    for (const reference of [
      "document-writing.md",
      "markdown-style.md",
      "page-prd.md",
      "total-prd.md",
      "field-spec.md",
      "api-document.md"
    ]) expect(skillSource).toContain(reference);

    expect(skillSource).toContain("only when the user has separately authorized document work");
    expect(workflow).toContain("Never create or edit a document from annotation synchronization alone");
    expect(workflow).toContain("read-only evidence");
    expect(workflow).toContain("must not modify annotation JSON");
    expect(style).toContain("three to six columns");
    expect(style).toContain("Do not emit empty placeholder tables");
  });

  it("routes specialized and generic document work without leaking borrowed logic", () => {
    const skillSource = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const prdWorkflow = readFileSync(
      path.join(skillRoot, "references/prd-workflow.md"),
      "utf8"
    );
    const documentWorkflow = readFileSync(
      path.join(skillRoot, "references/document-writing.md"),
      "utf8"
    );
    const skillRouting = skillSource.match(
      /Read these references when their subject applies:\s*([\s\S]*?)\n## Follow the control flow/
    )?.[1] ?? "";
    const skillDocumentSection = skillSource.match(
      /## Handle document intent separately\s*([\s\S]*?)\n## Remove the display layer safely/
    )?.[1] ?? "";
    const workflowDocumentSection = prdWorkflow.match(
      /## 4\. User-authorized document creation and update\s*([\s\S]*?)\n## 5\. Legacy migration/
    )?.[1] ?? "";

    expect(skillRouting).toContain(
      "Read [references/document-writing.md](references/document-writing.md) and [references/markdown-style.md](references/markdown-style.md) only when the user has separately authorized document work."
    );
    expect(skillDocumentSection).toContain(
      "These writing references never apply to installation, annotation creation, annotation synchronization, annotation editing, annotation deletion, route refresh, View refresh, or display-layer removal."
    );
    expect(skillDocumentSection).toContain(
      "Those operations must not load or apply the writing references and must not create or edit source documents."
    );

    const specializedRoutes = [
      ["page PRD", "page-prd.md"],
      ["total PRD", "total-prd.md"],
      ["Field specification", "field-spec.md"],
      ["API document", "api-document.md"]
    ];
    for (const [kind, reference] of specializedRoutes) {
      const route = `For an authorized ${kind}, read exactly one matching type-specific reference: [references/${reference}](references/${reference}).`;
      expect(skillRouting).toContain(route);
      expect(workflowDocumentSection).toContain(
        `An authorized ${kind} uses exactly one matching type-specific reference: \`${reference}\`.`
      );
    }
    expect(skillRouting).toContain(
      "For an authorized other related document, use only document-writing.md and markdown-style.md; do not guess or load a type-specific reference."
    );
    expect(workflowDocumentSection).toContain(
      "An authorized other related document uses the generic `document-writing.md` and `markdown-style.md` references only; never guess a specialized type."
    );
    expect(workflowDocumentSection).not.toContain(
      "exactly one applicable type-specific reference"
    );

    expect(documentWorkflow).toContain(
      "External borrowed document logic influences authorized document writing only; it never participates in annotation fields, storage, merge, deletion, identity, fingerprinting, or gates."
    );
    expect(documentWorkflow).toContain(
      "Refresh may update generated Manifest document inventory, Views, and route or display artifacts as applicable"
    );
    expect(documentWorkflow).toContain(
      "must not edit source documents except the authorized target and must never modify annotation JSON"
    );
    expect(documentWorkflow).not.toContain("refresh generated Views only");

    const nonDocumentSections = [
      skillSource.match(/## Discover and install safely\s*([\s\S]*?)\n## Synchronize annotations/)?.[1] ?? "",
      skillSource.match(/## Synchronize annotations\s*([\s\S]*?)\n## Handle document intent separately/)?.[1] ?? "",
      skillSource.match(/## Remove the display layer safely\s*([\s\S]*?)\n## Stop signals/)?.[1] ?? "",
      prdWorkflow.match(/## 2\. Universal annotation synchronization\s*([\s\S]*?)\n## 3\./)?.[1] ?? "",
      prdWorkflow.match(/## 5\. Legacy migration\s*([\s\S]*?)\n## 6\./)?.[1] ?? "",
      prdWorkflow.match(/## 6\. Snapshot-verified removal\s*([\s\S]*?)\n## 7\./)?.[1] ?? ""
    ];
    for (const section of nonDocumentSections) {
      expect(section).not.toMatch(
        /(?:Read|Load|Apply).*(?:document-writing\.md|markdown-style\.md|writing references)/
      );
      expect(section).not.toMatch(/(?:Write|Create|Edit) source documents?/);
    }
  });
});
